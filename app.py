from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import google.generativeai as genai
import json
import os
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin, login_user, LoginManager, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from dotenv import load_dotenv
from authlib.integrations.flask_client import OAuth

# Load environment variables
load_dotenv()

# Allow insecure transport for local testing
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

app = Flask(__name__)
CORS(app) # Enable CORS

# --- CONFIGURATION ---
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'dev_key_123')
app.secret_key = app.config['SECRET_KEY']

# --- DATABASE CONFIG ---
# Check for Vercel/Render/Railway Postgres URL
db_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")

if db_url:
    # Fix incompatible protocol for SQLAlchemy
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
else:
    # Fallback to local SQLite
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database_v2.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Google Config
app.config['GOOGLE_CLIENT_ID'] = os.getenv('GOOGLE_CLIENT_ID')
app.config['GOOGLE_CLIENT_SECRET'] = os.getenv('GOOGLE_CLIENT_SECRET')

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=app.config['GOOGLE_CLIENT_ID'],
    client_secret=app.config['GOOGLE_CLIENT_SECRET'],
    access_token_url='https://accounts.google.com/o/oauth2/token',
    access_token_params=None,
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    authorize_params=None,
    api_base_url='https://www.googleapis.com/oauth2/v1/',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',  # This is only needed if using openid to fetch user info
    client_kwargs={'scope': 'openid email profile'},
)

# --- GEMINI API SETUP ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyAAf1eX7_9FLid1o7UhVJqdn1poi4wpXTg")
genai.configure(api_key=GEMINI_API_KEY)

# --- MODELS ---
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), nullable=False, unique=True) # Used as email for Google Users
    password = db.Column(db.String(150), nullable=True) # Nullable for Google Users
    google_id = db.Column(db.String(100), unique=True, nullable=True)
    profile_pic = db.Column(db.String(300), nullable=True)
    projects = db.relationship('Project', backref='author', lazy=True)

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    data = db.Column(db.Text, nullable=False) # JSON string
    date = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- AI SERVICE ---
def generate_gemini_timeline(project_desc, deadline_str):
    """
    Calls Gemini Pro to generate a project plan in JSON.
    """
    try:
        # Prompt construction
        prompt = f"""
        You are an expert Senior Technical Project Manager. 
        Create a detailed project timeline for: "{project_desc}".
        Target Deadline: {deadline_str}.
        
        Output stricly VALID JSON with this structure:
        {{
            "project_title": "string",
            "executive_summary": "string",
            "risk_assessment": {{
                "level": "Low/Medium/High",
                "message": "string",
                "mitigation": "string"
            }},
            "phases": [
                {{
                    "name": "Phase Name",
                    "duration": "e.g. 1 Week",
                    "color": "blue|purple|green|orange",
                    "description": "Short phase description",
                    "tasks": [
                        {{ "name": "Task Name", "status": "Pending", "dependencies": "e.g. Task A" }}
                    ],
                    "ai_insight": "Specific technical advice for this phase."
                }}
            ]
        }}
        """

        # Try Gemini 2.5 Flash Lite first
        try:
            model = genai.GenerativeModel('gemini-2.5-flash-lite')
            response = model.generate_content(prompt)
        except:
            # Fallback to 1.5 Pro
            print("Fallback to gemini-1.5-pro triggered due to primary model failure.")
            model = genai.GenerativeModel('gemini-1.5-pro') 
            response = model.generate_content(prompt)
            
        # Extract JSON from potential markdown code blocks
        text = response.text
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        return json.loads(text)
        
    except Exception as e:
        print(f"Gemini Error: {e}")
        return {"error": str(e)}

# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
    desc = data.get('description')
    deadline = data.get('deadline')
    
    if not desc or not deadline:
        return jsonify({"error": "Missing input"}), 400
        
    result = generate_gemini_timeline(desc, deadline)
    
    # Save if logged in
    if current_user.is_authenticated and 'error' not in result:
        new_project = Project(
            title=result.get('project_title', 'Untitled Project'),
            data=json.dumps(result),
            user_id=current_user.id
        )
        db.session.add(new_project)
        db.session.commit()
    
    return jsonify(result)

# --- GOOGLE AUTH ROUTES ---
@app.route('/google/login')
def google_login():
    redirect_uri = url_for('google_authorize', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/google/callback')
def google_authorize():
    try:
        token = google.authorize_access_token()
        user_info = google.get('userinfo').json()
        
        email = user_info['email']
        name = user_info['name']
        google_id = user_info['id']
        picture = user_info.get('picture')

        user = User.query.filter_by(google_id=google_id).first()
        
        if not user:
            # Check if email exists (conflict or merge)
            email_user = User.query.filter_by(username=email).first()
            if email_user:
                user = email_user
                user.google_id = google_id
                user.profile_pic = picture
            else:
                user = User(
                    username=email, 
                    password="", # No password for Google users
                    google_id=google_id,
                    profile_pic=picture
                )
                db.session.add(user)
            db.session.commit()
        else:
            # Update profile pic
            user.profile_pic = picture
            db.session.commit()

        login_user(user)
        return redirect(url_for('index'))
    except Exception as e:
        print(f"Google Auth Error: {e}")
        return "Authentication failed.", 400

# --- AUTH ROUTES ---
@app.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "User already exists"}), 400
        
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password=hashed_password)
    db.session.add(new_user)
    db.session.commit()
    
    login_user(new_user)
    return jsonify({"message": "Registered successfully", "username": username})

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    user = User.query.filter_by(username=username).first()
    if user and user.password and bcrypt.check_password_hash(user.password, password):
        login_user(user)
        return jsonify({"message": "Login successful", "username": username})
    
    return jsonify({"error": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST', 'GET']) # Allow GET for easier logout link
@login_required
def logout():
    logout_user()
    if request.method == 'GET':
        return redirect(url_for('index'))
    return jsonify({"message": "Logged out"})

@app.route('/history', methods=['GET'])
@login_required
def get_history():
    projects = Project.query.filter_by(user_id=current_user.id).order_by(Project.date.desc()).all()
    history_data = []
    for p in projects:
        history_data.append({
            "id": p.id,
            "title": p.title,
            "date": p.date.strftime('%Y-%m-%d'),
            "summary": json.loads(p.data).get('executive_summary', '')[:100] + "..."
        })
    return jsonify(history_data)

@app.route('/project/<int:id>', methods=['GET'])
@login_required
def get_project(id):
    project = Project.query.get_or_404(id)
    if project.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403
    return jsonify(json.loads(project.data))

# Check auth status for frontend
@app.route('/auth_status', methods=['GET'])
def auth_status():
    if current_user.is_authenticated:
        return jsonify({
            "logged_in": True, 
            "username": current_user.username,
            "profile_pic": current_user.profile_pic
        })
    return jsonify({"logged_in": False})


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
else:
    # Ensure tables are created on production (Vercel) import
    with app.app_context():
        db.create_all()
