# Project Code Documentation

### app.py

```python
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
app.secret_key = app.config['SECRET_KEY'] # Ensure it is set directly on app object too as requested
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

```

### check_models.py

```python
import google.generativeai as genai
import os

GEMINI_API_KEY = "AIzaSyAAf1eX7_9FLid1o7UhVJqdn1poi4wpXTg"
genai.configure(api_key=GEMINI_API_KEY)

print("Listing available models...")
try:
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"- {m.name}")
except Exception as e:
    print(f"Error listing models: {e}")

```

### document_generator.py

```python
import os

def generate_documentation():
    output_file = "Project_Code_Documentation.md"
    project_root = os.getcwd()
    
    # Configuration
    included_extensions = {'.py', '.html', '.css', '.js', '.md'}
    excluded_dirs = {'venv', 'node_modules', '.git', '__pycache__', 'static/vendor'}
    
    with open(output_file, 'w', encoding='utf-8') as doc:
        doc.write("# Project Code Documentation\n\n")
        
        for root, dirs, files in os.walk(project_root):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in excluded_dirs]
            
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in included_extensions and file != output_file:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, project_root)
                    
                    # Skip the script itself if desired, or include it. 
                    # The user asked for "all my source code", so usually we include the generator too if it matches extensions.
                    # But let's strictly follow "Include only these extensions" which .py is part of.
                    
                    doc.write(f"### {rel_path}\n\n")
                    
                    # Determine language for code block
                    lang = ''
                    if ext == '.py': lang = 'python'
                    elif ext == '.js': lang = 'javascript'
                    elif ext == '.html': lang = 'html'
                    elif ext == '.css': lang = 'css'
                    elif ext == '.md': lang = 'markdown'
                    
                    doc.write(f"```{lang}\n")
                    
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            doc.write(content)
                    except Exception as e:
                        doc.write(f"Error reading file: {e}")
                        
                    doc.write("\n```\n\n")
                    
    print(f"Documentation generated at: {os.path.abspath(output_file)}")

if __name__ == "__main__":
    generate_documentation()

```

### test_api.py

```python
import google.generativeai as genai
import os

# Use the key from app.py
GEMINI_API_KEY = "AIzaSyAAf1eX7_9FLid1o7UhVJqdn1poi4wpXTg"
genai.configure(api_key=GEMINI_API_KEY)

models_to_test = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-pro",
    "gemini-1.0-pro"
]

print(f"Testing API Key: {GEMINI_API_KEY[:10]}...")

for model_name in models_to_test:
    print(f"\n--- Testing {model_name} ---")
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content("Hello, can you reply with 'OK'?")
        print(f"SUCCESS! Response: {response.text}")
    except Exception as e:
        print(f"FAILED: {e}")

```

### static\css\style.css

```css
/* Animations */
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.fade-in-up {
    opacity: 0; /* Hidden initially */
}

/* Glassmorphism Utilities */
.glass-panel {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 8px;
}
::-webkit-scrollbar-track {
    background: #0f172a; 
}
::-webkit-scrollbar-thumb {
    background: #334155; 
    border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
    background: #475569; 
}

```

### static\js\animations.js

```javascript
/**
 * Premium UI Animations for TimelineAi
 * Features:
 * 1. WebGL Fluid Orb Background (Shader)
 * 2. Confetti Particle Cursor (Canvas)
 */

class AnimationManager {
    constructor() {
        this.initFluidBackground();
        this.initParticleCursor();
    }

    initFluidBackground() {
        const canvas = document.getElementById('bgCanvas');
        if (!canvas) return;

        const gl = canvas.getContext('webgl');
        if (!gl) return;

        // Resize handler
        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            gl.viewport(0, 0, canvas.width, canvas.height);
        };
        window.addEventListener('resize', resize);
        resize();

        // Vertex Shader (Simple Quad)
        const vsSource = `
            attribute vec2 position;
            varying vec2 vUv;
            void main() {
                vUv = position * 0.5 + 0.5;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;

        // Fragment Shader (Fluid Orb)
        const fsSource = `
            precision mediump float;
            uniform float u_time;
            uniform vec2 u_resolution;
            uniform vec2 u_mouse;
            varying vec2 vUv;

            // Simple noise function
            float noise(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {
                vec2 st = gl_FragCoord.xy / u_resolution.xy;
                st.x *= u_resolution.x / u_resolution.y;
                
                vec2 mouse = u_mouse / u_resolution.xy;
                mouse.x *= u_resolution.x / u_resolution.y;

                float t = u_time * 0.5;
                
                // Orb centers
                vec2 c1 = vec2(0.5, 0.5) + vec2(cos(t * 0.5), sin(t * 0.3)) * 0.2;
                vec2 c2 = mouse; // Mouse follows

                // Distances
                float d1 = length(st - c1);
                float d2 = length(st - c2);

                // Fluid mix
                float f = 0.0;
                f += 0.5 / d1;
                f += 0.3 / (d2 + 0.1); // Add mouse influence
                
                // Color Morph - Dark SaaS Theme (Purple/Blue/Cyan)
                vec3 color = vec3(0.0);
                
                // Brighter/Larger Orb
                // f is inverse distance. larger f = closer to center.
                // 0.5/d1. if d1=0.5, f=1.0. if d1=0.25, f=2.0.
                
                color += vec3(0.4, 0.2, 0.9) * smoothstep(1.0, 3.0, f); // Deep Purple Base
                color += vec3(0.2, 0.6, 1.0) * smoothstep(2.5, 6.0, f) * 0.8; // Blue Glow Core
                
                // Add subtle background noise/stars
                float n = noise(st * 10.0 + t * 0.1);
                color += vec3(0.5, 0.5, 0.8) * n * 0.05;

                // Ensure background isn't pure black transparency if we want it to be the "Nebula"
                // But we want it to blend with CSS background?
                // Provide a base alpha that is non-zero
                
                gl_FragColor = vec4(color, color.r * 0.5 + 0.5); // Add alpha based on brightness
            }
        `;

        // Compile Shaders
        const createShader = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error(gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = createShader(gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.useProgram(program);

        // Buffer
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        const positionLoc = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

        // Uniforms
        const timeLoc = gl.getUniformLocation(program, 'u_time');
        const resLoc = gl.getUniformLocation(program, 'u_resolution');
        const mouseLoc = gl.getUniformLocation(program, 'u_mouse');

        let mouseX = 0, mouseY = 0;
        window.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY; // Fix Y coordinate for WebGL
            mouseY = window.innerHeight - e.clientY;
        });

        // Loop
        const render = (time) => {
            time *= 0.001; // Seconds
            gl.uniform1f(timeLoc, time);
            gl.uniform2f(resLoc, canvas.width, canvas.height);
            gl.uniform2f(mouseLoc, mouseX, mouseY);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    initParticleCursor() {
        const input = document.getElementById('projectDesc');
        if (!input) return;

        // Create overlay canvas for particles
        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '9999';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const particles = [];

        // Colors: Purple, Blue, Cyan, White
        const colors = ['#7b68ee', '#3b82f6', '#06b6d4', '#ffffff'];

        // Particle Class
        class Particle {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.size = Math.random() * 3 + 1;
                this.speedX = Math.random() * 4 - 2;
                this.speedY = Math.random() * 4 - 2;
                this.color = colors[Math.floor(Math.random() * colors.length)];
                this.life = 1.0;
            }
            update() {
                this.x += this.speedX;
                this.y += this.speedY;
                this.life -= 0.03;
                this.size *= 0.95;
            }
            draw() {
                ctx.fillStyle = this.color;
                ctx.globalAlpha = this.life;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Helper to get caret coordinates (Robust Mirror Div)
        const getCaretCoordinates = (element, position) => {
            const div = document.createElement('div');
            const style = getComputedStyle(element);

            // Copy styles
            const properties = [
                'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
                'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
                'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'
            ];

            properties.forEach(prop => {
                div.style[prop] = style[prop];
            });

            div.style.position = 'absolute';
            div.style.top = '0px';
            div.style.left = '0px';
            div.style.visibility = 'hidden';
            div.style.whiteSpace = 'pre-wrap';
            div.style.wordWrap = 'break-word'; // Important for textarea

            // Content
            div.textContent = element.value.substring(0, position);

            const span = document.createElement('span');
            span.textContent = element.value.substring(position) || '.';
            div.appendChild(span);

            document.body.appendChild(div);

            const rect = element.getBoundingClientRect();
            const coordinates = {
                top: div.scrollTop + span.offsetTop, // Span offset relative to div
                left: span.offsetLeft,
                height: parseInt(style.lineHeight) // approximate
            };

            document.body.removeChild(div);

            // Calculate absolute position on screen
            return {
                x: rect.left + coordinates.left + parseInt(style.borderLeftWidth) + parseInt(style.paddingLeft),
                y: rect.top + coordinates.top + parseInt(style.borderTopWidth) + parseInt(style.paddingTop) - element.scrollTop
            };
        };

        // Listeners
        const addParticles = () => {
            const pos = input.selectionStart;
            const coords = getCaretCoordinates(input, pos);

            // Emit particles from caret
            for (let i = 0; i < 5; i++) {
                particles.push(new Particle(coords.x, coords.y + 10)); // +10 for visual offset
            }
        };

        input.addEventListener('input', addParticles);
        input.addEventListener('keydown', (e) => {
            // Also spark on arrow keys etc
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace'].includes(e.key)) {
                setTimeout(addParticles, 0);
            }
        });

        // Resize
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });

        // Loop
        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < particles.length; i++) {
                particles[i].update();
                particles[i].draw();
                if (particles[i].life <= 0) {
                    particles.splice(i, 1);
                    i--;
                }
            }
            requestAnimationFrame(animate);
        };
        animate();
    }
}

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => {
    window.animations = new AnimationManager();
});

```

### static\js\app.js

```javascript
const app = {
    currentData: null,
    isLoginMode: true,
    currentUser: null,
    notifications: [], // Store notifications
    mockTemplates: [], // Store 20 templates

    init: async () => {
        // ... (Listeners preserved)
        document.getElementById('generateBtn').addEventListener('click', app.generatePlan);
        document.getElementById('authActionBtn').addEventListener('click', app.handleAuth);
        document.getElementById('authToggleBtn').addEventListener('click', app.toggleAuthMode);

        await app.checkAuthStatus();
        app.initTheme();
        app.generateMockTemplates();
        app.renderTemplates();

        // Templates Link Handler
        document.querySelector('a[href="#templates"]').onclick = (e) => {
            e.preventDefault();
            app.showTemplates();
        };

        // Click outside for Notification Dropdown
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('notificationDropdown');
            const btn = e.target.closest('button[onclick="app.toggleNotifications()"]');
            if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn) {
                dropdown.classList.add('hidden');
            }
        });

        // --- GSAP HERO ANIMATIONS ---
        if (window.gsap) {
            const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
            tl.from("main header", { y: -20, opacity: 0, duration: 0.8 })
                .from("#inputSection h1", { y: 20, opacity: 0, duration: 0.8 }, "-=0.6")
                .from("#inputSection p", { y: 20, opacity: 0, duration: 0.8 }, "-=0.6")
                .from("#inputSection .bg-surface", { scale: 0.95, opacity: 0, duration: 0.8 }, "-=0.6")
                .from("#inputSection .grid > div", { y: 20, opacity: 0, duration: 0.6, stagger: 0.1 }, "-=0.4");

            // Magnetic/Scale Hover Effect
            const buttons = document.querySelectorAll('button, .task-card');
            buttons.forEach(btn => {
                btn.addEventListener('mouseenter', () => gsap.to(btn, { scale: 1.02, duration: 0.3 }));
                btn.addEventListener('mouseleave', () => gsap.to(btn, { scale: 1, duration: 0.3 }));
            });
        }
    },

    // --- THEME ---
    initTheme: () => {
        const storedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (storedTheme === 'dark' || (!storedTheme && systemDark)) {
            document.documentElement.classList.add('dark');
            app.updateThemeUI(true);
        } else {
            document.documentElement.classList.remove('dark');
            app.updateThemeUI(false);
        }
    },

    toggleTheme: () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        app.updateThemeUI(isDark);
    },

    updateThemeUI: (isDark) => {
        const icon = document.getElementById('themeIcon');
        const text = document.getElementById('themeText');
        if (icon && text) {
            icon.innerText = isDark ? 'light_mode' : 'dark_mode';
            text.innerText = isDark ? 'Light Mode' : 'Dark Mode';
        }
    },

    // --- NOTIFICATIONS ---
    toggleNotifications: () => {
        const dropdown = document.getElementById('notificationDropdown');
        dropdown.classList.toggle('hidden');

        // Clear badge on open
        if (!dropdown.classList.contains('hidden')) {
            const badge = document.getElementById('notificationBadge');
            badge.classList.add('hidden');
        }
    },

    clearNotifications: () => {
        app.notifications = [];
        app.updateNotificationDropdown();
    },

    showNotification: (message, type = 'info') => {
        // 1. Add to history
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        app.notifications.unshift({ message, type, time: timestamp });
        if (app.notifications.length > 10) app.notifications.pop(); // keep last 10

        // 2. Update Badge & Dropdown
        const badge = document.getElementById('notificationBadge');
        if (document.getElementById('notificationDropdown').classList.contains('hidden')) {
            badge.classList.remove('hidden');
        }
        app.updateNotificationDropdown();

        // 3. Show Toast
        const container = document.getElementById('notificationContainer');
        const toast = document.createElement('div');

        const icons = { success: 'check_circle', error: 'error', info: 'info' };
        const iconName = icons[type] || 'info';

        const baseClasses = "flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-fade-in bg-surface min-w-[300px] z-[100]";
        const typeClasses = {
            success: "border-green-500/20 text-green-700",
            error: "border-red-500/20 text-red-700",
            info: "border-blue-500/20 text-blue-700",
            neutral: "border-gray-200 text-gray-700"
        };
        const variantClass = typeClasses[type] || typeClasses.info;
        toast.className = `${baseClasses} ${variantClass}`;

        const iconColors = { success: "text-green-500", error: "text-red-500", info: "text-blue-500" }
        const iconColor = iconColors[type] || "text-blue-500";

        toast.innerHTML = `
            <span class="material-symbols-outlined text-[20px] ${iconColor}">${iconName}</span>
            <span class="text-sm font-semibold flex-1">${message}</span>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    updateNotificationDropdown: () => {
        const list = document.getElementById('notificationList');
        if (!list) return;

        list.innerHTML = '';
        if (app.notifications.length === 0) {
            list.innerHTML = `<div class="p-4 text-center text-text-muted text-xs">No notifications yet</div>`;
            return;
        }

        app.notifications.forEach(n => {
            const el = document.createElement('div');
            el.className = "flex items-start gap-3 p-3 border-b border-border-light hover:bg-gray-50 transition-colors";

            const iconColors = { success: "text-green-500", error: "text-red-500", info: "text-blue-500" };
            const icon = { success: 'check_circle', error: 'error', info: 'info' }[n.type] || 'info';

            el.innerHTML = `
                 <span class="material-symbols-outlined text-[16px] mt-0.5 ${iconColors[n.type]}">${icon}</span>
                 <div class="flex-1">
                     <p class="text-xs font-semibold text-text-main leading-snug">${n.message}</p>
                     <p class="text-[10px] text-text-muted mt-1">${n.time}</p>
                 </div>
            `;
            list.appendChild(el);
        });
    },

    // --- MOCK TEMPLATES ---
    generateMockTemplates: () => {
        const topics = ["SaaS Launch", "Mobile App", "Marketing Campaign", "Wedding Plan", "Website Redesign", "E-commerce Store", "Product Hunt Launch", "Podcast Series", "YouTube Channel", "Fitness App"];
        const styles = ["Agile", "Waterfall", "Kanban", "Scrum"];

        for (let i = 1; i <= 20; i++) {
            const topic = topics[i % topics.length];
            const style = styles[i % styles.length];
            app.mockTemplates.push({
                id: i,
                title: `${topic} V${Math.ceil(i / 3)}`,
                description: `A comprehensive ${style} template for executing a ${topic}. Includes pre-defined milestones and risk analysis.`,
                tags: [style, "Template"],
                color: ["blue", "purple", "green", "orange"][i % 4]
            });
        }
    },

    renderTemplates: () => {
        const grid = document.getElementById('templatesGrid');
        if (!grid) return;
        grid.innerHTML = '';
        app.mockTemplates.forEach(t => {
            const card = document.createElement('div');
            card.className = "bg-surface border border-border-light rounded-xl p-6 hover:shadow-lg hover:border-brand-purple/50 transition-all cursor-pointer group flex flex-col";
            card.onclick = () => {
                app.loadTemplate(t);
            };

            const badgeColor = {
                blue: "bg-blue-100 text-blue-700",
                purple: "bg-purple-100 text-purple-700",
                green: "bg-green-100 text-green-700",
                orange: "bg-orange-100 text-orange-700"
            }[t.color];

            card.innerHTML = `
                <div class="flex items-start justify-between mb-4">
                    <div class="w-10 h-10 rounded-lg ${badgeColor} flex items-center justify-center">
                        <span class="material-symbols-outlined">folder_open</span>
                    </div>
                    <span class="material-symbols-outlined text-border-light group-hover:text-brand-purple transition-colors">arrow_forward</span>
                </div>
                <h3 class="font-bold text-text-main text-lg mb-2 group-hover:text-brand-purple transition-colors">${t.title}</h3>
                <p class="text-xs text-text-muted leading-relaxed mb-4 flex-1">${t.description}</p>
                <div class="flex gap-2">
                    ${t.tags.map(tag => `<span class="px-2 py-1 bg-main-bg rounded text-[10px] font-bold text-text-muted uppercase tracking-wider">${tag}</span>`).join('')}
                </div>
            `;
            grid.appendChild(card);
        });
    },

    resetView: () => {
        // Soft reset for New Roadmap
        document.getElementById('inputSection').classList.remove('hidden');
        document.getElementById('resultSection').classList.add('hidden');
        document.getElementById('templatesSection').classList.add('hidden');

        // Clear data
        app.currentData = null;
        document.getElementById('timelineContainer').innerHTML = '';
        document.getElementById('projectDesc').value = '';
        document.getElementById('deadline').value = '';

        // Reset Title
        document.getElementById('pageTitle').innerText = "New Roadmap";
    },

    showTemplates: () => {
        document.getElementById('inputSection').classList.add('hidden');
        document.getElementById('resultSection').classList.add('hidden');
        document.getElementById('templatesSection').classList.remove('hidden');

        // Clean up ghost content
        document.getElementById('timelineContainer').innerHTML = '';

        // Update Title
        document.getElementById('pageTitle').innerText = "Templates Library";
    },

    loadTemplate: (template) => {
        document.getElementById('templatesSection').classList.add('hidden');
        document.getElementById('inputSection').classList.remove('hidden');
        document.getElementById('projectDesc').value = `Based on Template: ${template.title}\n${template.description}`;
        document.getElementById('pageTitle').innerText = "New Roadmap";
        app.showNotification(`Loaded template: ${template.title}`, "success");
    },


    // --- AUTH ---
    checkAuthStatus: async () => {
        try {
            const res = await fetch('/auth_status');
            const data = await res.json();
            if (data.logged_in) {
                app.currentUser = data.username;
                const userAvatar = document.getElementById('userAvatar');
                if (data.profile_pic) {
                    userAvatar.innerHTML = `<img src="${data.profile_pic}" class="w-full h-full rounded-full object-cover">`;
                    userAvatar.classList.remove('bg-brand-purple'); // Remove background color if image exists
                } else {
                    userAvatar.innerText = app.currentUser.charAt(0).toUpperCase();
                }

                app.updateHeaderState(true);
                app.showNotification(`Welcome back, ${data.username}!`, "success");
            } else {
                app.updateHeaderState(false);
            }
        } catch (e) { console.error(e); }
    },

    updateHeaderState: (isLoggedIn) => {
        const authButtons = document.getElementById('authButtons');
        const userMenu = document.getElementById('userMenu');
        const historyLink = document.getElementById('historyLink');

        if (isLoggedIn) {
            authButtons.classList.add('hidden');
            userMenu.classList.remove('hidden');
            userMenu.classList.add('flex');
            historyLink.classList.remove('hidden');
            historyLink.classList.add('flex');

            document.getElementById('displayUsername').innerText = app.currentUser;
            document.getElementById('userAvatar').innerText = app.currentUser.charAt(0).toUpperCase();
        } else {
            authButtons.classList.remove('hidden');
            userMenu.classList.add('hidden');
            userMenu.classList.remove('flex');
            historyLink.classList.add('hidden');
            historyLink.classList.remove('flex');
        }
    },

    showAuthModal: () => document.getElementById('authModal').classList.remove('hidden'),
    closeAuthModal: () => document.getElementById('authModal').classList.add('hidden'),

    toggleAuthMode: () => {
        app.isLoginMode = !app.isLoginMode;
        const title = document.getElementById('authTitle');
        const subtitle = document.getElementById('authSubtitle');
        const btn = document.getElementById('authActionBtn');
        const toggle = document.getElementById('authToggleBtn');

        if (app.isLoginMode) {
            title.innerText = 'Welcome Back';
            subtitle.innerText = 'Login to access your projects.';
            btn.innerText = 'Log In';
            toggle.innerText = "Don't have an account? Sign Up";
        } else {
            title.innerText = 'Create Workspace';
            subtitle.innerText = 'Join to start planning projects.';
            btn.innerText = 'Sign Up';
            toggle.innerText = "Already have an account? Log In";
        }
    },

    handleAuth: async () => {
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;

        if (!username || !password) return app.showNotification("Please fill in all fields", "error");

        const endpoint = app.isLoginMode ? '/login' : '/register';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (res.ok) {
                app.currentUser = data.username;
                app.updateHeaderState(true);
                app.closeAuthModal();
                app.showNotification(app.isLoginMode ? "Logged in successfully!" : "Account created!", "success");
            } else {
                app.showNotification(data.error || "Authentication failed", "error");
            }
        } catch (e) {
            console.error(e);
            app.showNotification("An error occurred", "error");
        }
    },

    logout: async () => {
        await fetch('/logout', { method: 'POST' });
        app.currentUser = null;
        app.updateHeaderState(false);
        app.showNotification("Logged out successfully", "neutral");
        setTimeout(() => location.reload(), 1000);
    },

    showHistory: async () => {
        try {
            const res = await fetch('/history');
            const data = await res.json();

            const list = document.getElementById('historyList');
            list.innerHTML = '';

            if (data.length === 0) {
                list.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-12 text-center">
                        <span class="material-symbols-outlined text-4xl text-gray-300 mb-2">history_edu</span>
                        <p class="text-text-muted text-sm">No project history found.</p>
                    </div>`;
            }

            data.forEach(item => {
                const el = document.createElement('div');
                el.className = 'bg-white p-4 rounded-lg border border-border-light hover:border-brand-purple/50 cursor-pointer transition-all hover:shadow-sm group';
                el.onclick = () => app.loadProject(item.id);
                el.innerHTML = `
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-text-main group-hover:text-brand-purple transition-colors">${item.title}</h4>
                        <span class="text-xs text-text-muted bg-gray-100 px-2 py-1 rounded">${item.date}</span>
                    </div>
                    <p class="text-xs text-text-muted truncate">${item.summary}</p>
                `;
                list.appendChild(el);
            });

            document.getElementById('historyModal').classList.remove('hidden');
        } catch (e) { console.error(e); app.showNotification("Failed to load history", "error"); }
    },

    closeHistoryModal: () => document.getElementById('historyModal').classList.add('hidden'),

    loadProject: async (id) => {
        try {
            const res = await fetch(`/project/${id}`);
            const data = await res.json();
            app.currentData = data;
            app.closeHistoryModal();

            // Hide Templates if open
            document.getElementById('templatesSection').classList.add('hidden');

            document.getElementById('inputSection').classList.add('hidden');
            document.getElementById('resultSection').classList.remove('hidden');
            document.getElementById('pageTitle').innerText = data.project_title || "Project Details";
            app.renderResults(data);
            app.showNotification("Project loaded", "success");
        } catch (e) { console.error(e); app.showNotification("Failed to load project details", "error"); }
    },

    simulateLoadingSteps: () => {
        const stepsContainer = document.getElementById('loadingSteps');
        const steps = [
            { text: "Verifying project scope...", color: "text-blue-400" },
            { text: "Allocating AI resources...", color: "text-purple-400" },
            { text: "Analyzing risk factors...", color: "text-orange-400" },
            { text: "Calculating critical path...", color: "text-green-400" }
        ];

        stepsContainer.innerHTML = '';
        let stepIndex = 0;

        return setInterval(() => {
            if (stepIndex >= steps.length) return;
            const step = steps[stepIndex];
            const el = document.createElement('div');
            el.className = "flex items-center gap-3 text-xs text-slate-300 animate-fade-in";
            el.innerHTML = `
                <span class="material-symbols-outlined text-[14px] ${step.color}">check_circle</span>
                <span>${step.text}</span>
            `;
            stepsContainer.appendChild(el);
            stepIndex++;
        }, 1200);
    },

    generatePlan: async () => {
        const desc = document.getElementById('projectDesc').value;
        const deadline = document.getElementById('deadline').value;

        if (!desc || !deadline) {
            app.showNotification("Please provide both a description and deadline.", "error");
            return;
        }

        document.getElementById('inputSection').classList.add('hidden');
        document.getElementById('loadingOverlay').classList.remove('hidden');
        document.getElementById('loadingOverlay').classList.add('flex');

        const loadingInterval = app.simulateLoadingSteps();

        try {
            const response = await fetch('/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: desc, deadline: deadline })
            });
            const data = await response.json();

            clearInterval(loadingInterval);
            if (data.error) throw new Error(data.error);

            app.currentData = data;

            setTimeout(() => {
                document.getElementById('loadingOverlay').classList.add('hidden');
                document.getElementById('loadingOverlay').classList.remove('flex');
                document.getElementById('resultSection').classList.remove('hidden');
                app.renderResults(data);
                app.showNotification("Timeline generated successfully!", "success");
            }, 500);

        } catch (error) {
            clearInterval(loadingInterval);
            console.error(error);
            app.showNotification("Generation failed: " + error.message, "error");

            document.getElementById('loadingOverlay').classList.add('hidden');
            document.getElementById('loadingOverlay').classList.remove('flex');
            document.getElementById('inputSection').classList.remove('hidden'); // Go back
        }
    },

    renderResults: (data) => {
        document.getElementById('resProjectTitle').innerText = data.project_title;
        document.getElementById('resExecSummary').innerText = data.executive_summary;

        if (data.risk_assessment) {
            const riskBanner = document.getElementById('riskBanner');
            riskBanner.classList.remove('hidden');
            document.getElementById('riskMessage').innerText = `${data.risk_assessment.message} Mitigation: ${data.risk_assessment.mitigation}`;
        }

        const container = document.getElementById('timelineContainer');
        container.innerHTML = ''; // Clear previous

        if (!data.phases) return;

        data.phases.forEach((phase, index) => {
            // New "ClickUp Task" style cards
            const card = document.createElement('div');
            card.className = "task-card relative p-6 cursor-pointer group";
            card.onclick = () => app.openModal(index);

            // Side Badge Color
            const colors = {
                blue: "bg-blue-500",
                purple: "bg-purple-500",
                green: "bg-green-500",
                orange: "bg-orange-500"
            };
            const barColor = colors[phase.color] || colors.blue;

            card.innerHTML = `
                <div class="absolute -left-[31px] top-6 w-4 h-4 rounded-full border-[3px] border-white ${barColor} shadow-sm z-10"></div>
                
                <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-2">
                         <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-text-muted border border-border-light">${phase.duration}</span>
                         <h3 class="text-base font-bold text-text-main group-hover:text-brand-purple transition-colors">${phase.name}</h3>
                    </div>
                    <span class="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
                </div>
                
                <p class="text-sm text-text-muted leading-relaxed mb-4">${phase.description || ''}</p>
                
                <div class="flex items-center gap-4 border-t border-border-light pt-3">
                    <div class="flex items-center gap-1 text-xs text-text-muted">
                        <span class="material-symbols-outlined text-[16px]">check_circle</span>
                        <span>${phase.tasks ? phase.tasks.length : 0} Tasks</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });



        // GSAP Staggered Reveal
        if (window.gsap) {
            gsap.from(".task-card", {
                y: 30,
                opacity: 0,
                duration: 0.6,
                stagger: 0.1,
                ease: "power2.out",
                clearProps: "all"
            });
        }

        setTimeout(app.initObservers, 100);
    },

    openModal: (phaseIndex) => {
        const phase = app.currentData.phases[phaseIndex];

        document.getElementById('modalTitle').innerText = phase.name;
        document.getElementById('modalDuration').innerText = phase.duration;
        document.getElementById('modalInsight').innerText = phase.ai_insight || "No specific insights for this phase.";

        const taskContainer = document.getElementById('modalTasksList');
        taskContainer.innerHTML = '';

        phase.tasks.forEach((task, i) => {
            const taskEl = document.createElement('div');
            const avatars = [
                'https://lh3.googleusercontent.com/aida-public/AB6AXuCvB2ZoH8fYUqC5o1YERG0-Dyyv3I9M2vqiWIhaFUxXBHlwNMhpwhmviQIZ0SaPpKB5HG6NmkbvMbZ3c19_0mUsyd0TN1Mt1ce_cNGX_qtkysM6LyPM_ylcogiBTxLyfYOHYqEbODRtf3DGYrcCSD0N_sXjJETVlH5xjEKV_5AZZ5pgtttGDOngCd3GDxUJt82OBqKasQhIbOSLaX6HBdOP4RqpFIzGAnUyeftOTqFcZzHzX1Qpjt0pNMY6IBZ0DYgeIpJvGrINZUM',
                'https://lh3.googleusercontent.com/aida-public/AB6AXuDmGfeaCVbhpbU0meuZ86BMtVNEcaq3Ggg0bFL2jJoiV3lAd7ptkAqJPpm1E0oQf5RIAVLQtL3iYaj0d7vyv2QOVMWUwQ7yIbvHM0IQN8KlKIl4RPYS_ejUqYvDwgpS5UBaD0t08e9clyflPakpo1EdB_Lzevjwx2P6BN6nhzcVyKdftPo7G3FgweUuJ2iAzHu7-wI2-Vfu96X0wV0RBnUiVrGF8rn8u41TcpWsZ-YeCVpK5oI6Dk_Ms-XJNV5OkuyVCx8YvPm_cJk'
            ];
            const avatar = avatars[i % avatars.length];

            taskEl.className = "group flex items-center gap-4 p-4 hover:bg-white/5 transition-colors cursor-pointer select-none border-b border-white/5 last:border-b-0";

            taskEl.onclick = (e) => {
                if (e.target.type !== 'checkbox') {
                    const cb = taskEl.querySelector('.task-checkbox');
                    cb.checked = !cb.checked;
                }
            };

            taskEl.innerHTML = `
                <div class="relative flex items-center justify-center shrink-0">
                    <input type="checkbox" class="task-checkbox peer h-5 w-5 rounded border-slate-600 bg-transparent text-primary focus:ring-0 focus:ring-offset-0 transition-all checked:bg-primary checked:border-primary cursor-pointer" />
                </div>
                <div class="flex-1 flex flex-col">
                    <span class="text-slate-200 group-hover:text-white transition-colors peer-checked:line-through peer-checked:text-slate-500">${task.name}</span>
                    <span class="text-xs text-slate-500">Scheduled task</span>
                </div>
                <div class="h-8 w-8 rounded-full bg-cover bg-center ring-2 ring-[#151b26] grayscale opacity-50 shrink-0" style="background-image: url('${avatar}');"></div>
            `;
            taskContainer.appendChild(taskEl);
        });

        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    checkAllTasks: () => {
        const checkboxes = document.querySelectorAll('.task-checkbox');
        let allChecked = true;
        checkboxes.forEach(cb => { if (!cb.checked) allChecked = false; });
        checkboxes.forEach(cb => { cb.checked = !allChecked; });
        app.showNotification(allChecked ? "Unchecked all tasks" : "All tasks checked", "info");
    },

    closeModal: () => document.getElementById('modalOverlay').classList.add('hidden'),

    // --- EXPORT LOGIC ---
    exportTimeline: () => {
        const data = app.currentData;
        if (!data) return app.showNotification("No data to export", "error");

        app.showNotification("Generating PDF...", "info");

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // --- TITLE ---
            doc.setFontSize(22);
            doc.setTextColor(40, 40, 40);
            doc.text(data.project_title || "Project Timeline", 14, 20);

            // --- EXECUTIVE SUMMARY ---
            doc.setFontSize(11);
            doc.setTextColor(80, 80, 80);
            const splitSummary = doc.splitTextToSize(data.executive_summary || "", 180);
            doc.text(splitSummary, 14, 30);

            let finalY = 30 + (splitSummary.length * 5) + 10;

            // --- RISK ASSESSMENT ---
            if (data.risk_assessment) {
                doc.setFontSize(14);
                doc.setTextColor(200, 50, 0); // Orange/Red
                doc.text("Risk Assessment", 14, finalY);
                finalY += 6;

                doc.setFontSize(10);
                doc.setTextColor(60, 60, 60);
                const riskText = `Level: ${data.risk_assessment.level}\nMessage: ${data.risk_assessment.message}\nMitigation: ${data.risk_assessment.mitigation}`;
                const splitRisk = doc.splitTextToSize(riskText, 180);
                doc.text(splitRisk, 14, finalY);
                finalY += (splitRisk.length * 4) + 10;
            }

            // --- TIMELINE TABLE ---
            const tableBody = [];

            if (data.phases) {
                data.phases.forEach(phase => {
                    // Phase Header Row
                    tableBody.push([
                        { content: phase.name.toUpperCase(), colSpan: 4, styles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: [50, 50, 50] } }
                    ]);

                    // Task Rows
                    if (phase.tasks) {
                        phase.tasks.forEach(task => {
                            tableBody.push([
                                phase.name, // Phase Name (Col 1)
                                task.name,  // Milestone/Task (Col 2)
                                phase.duration, // Duration (Col 3)
                                task.dependencies || "-" // Dependencies (Col 4)
                            ]);
                        });
                    }
                });
            }

            doc.autoTable({
                startY: finalY,
                head: [['Phase', 'Milestone/Task', 'Duration', 'Dependencies']],
                body: tableBody,
                theme: 'grid',
                headStyles: { fillColor: [123, 104, 238], textColor: 255, fontStyle: 'bold' }, // Brand Purple
                styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
                columnStyles: {
                    0: { fontStyle: 'bold', width: 40 },
                    1: { width: 70 },
                    2: { width: 30 },
                    3: { width: 40 }
                },
                margin: { top: 20, bottom: 20 }
            });

            // Footer
            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text(`Page ${i} of ${pageCount} | Generated by TimelineAi`, 105, 290, { align: 'center' });
            }

            doc.save("project_roadmap.pdf");
            app.showNotification("PDF Exported Successfully!", "success");

        } catch (e) {
            console.error(e);
            app.showNotification("PDF Export Failed. Ensure jspdf is loaded.", "error");
        }
    }
};
document.addEventListener('DOMContentLoaded', app.init);

```

### templates\index.html

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8" />
    <meta content="width=device-width, initial-scale=1.0" name="viewport" />
    <title>TimelineAI</title>
    <link rel="icon" type="image/svg+xml" href="{{ url_for('static', filename='favicon.svg') }}">

    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com" rel="preconnect" />
    <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect" />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
        rel="stylesheet" />

    <!-- Material Symbols -->
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        rel="stylesheet" />

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "brand-purple": "#7b68ee",
                        "brand-purple-dark": "#5f48ea",
                        "sidebar-bg": "#242938",
                        "sidebar-hover": "#2f3646",
                        "main-bg": "#f7f8f9",
                        "surface": "#ffffff",
                        "text-main": "#292d34",
                        "text-muted": "#7c828d",
                        "border-light": "#e6e9f0",
                        "success": "#2ecc71",
                        "warning": "#f1c40f",
                    },
                    fontFamily: {
                        "sans": ["Manrope", "sans-serif"],
                    },
                    animation: {
                        'fade-in': 'fadeIn 0.3s ease-out',
                        'slide-up': 'slideUp 0.4s ease-out',
                    },
                    keyframes: {
                        fadeIn: {
                            '0%': { opacity: '0' },
                            '100%': { opacity: '1' }
                        },
                        slideUp: {
                            '0%': { transform: 'translateY(10px)', opacity: '0' },
                            '100%': { transform: 'translateY(0)', opacity: '1' }
                        }
                    }
                },
            },
        }
    </script>

    <style>
        body {
            font-family: 'Manrope', sans-serif;
            /* background-color handled by tailwind classes */
        }

        /* Sidebar Scrollbar */
        .sidebar-scroll::-webkit-scrollbar {
            width: 4px;
        }

        .sidebar-scroll::-webkit-scrollbar-thumb {
            background: #3d4455;
            border-radius: 4px;
        }

        /* Card Styles */
        .task-card {
            background: white;
            border: 1px solid #e6e9f0;
            border-radius: 12px;
            transition: all 0.2s ease;
        }

        .task-card:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            border-color: #7b68ee;
            transform: translateY(-2px);
        }

        /* Glass Modal */
        .glass-modal {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid #e6e9f0;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
    </style>
</head>

<body class="flex h-screen overflow-hidden text-sm relative bg-main-bg dark:bg-[#0f172a] text-text-main">

    <!-- Background Animation Canvas -->
    <canvas id="bgCanvas" class="fixed inset-0 w-full h-full z-0 pointer-events-none"></canvas>

    <!-- Notification Container -->
    <div id="notificationContainer"
        class="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col items-end gap-2"></div>

    <!-- SIDEBAR -->
    <aside
        class="w-64 bg-sidebar-bg flex flex-col flex-shrink-0 transition-all duration-300 relative z-10 bg-opacity-95 backdrop-blur-sm">
        <!-- Logo -->
        <div class="h-16 flex items-center px-6 border-b border-white/5">
            <div class="w-8 h-8 bg-brand-purple rounded-md flex items-center justify-center mr-3 text-white">
                <span class="material-symbols-outlined text-lg">timeline</span>
            </div>
            <span class="text-white font-bold text-lg tracking-wide">TimelineAI</span>
        </div>

        <!-- Scrollable Nav -->
        <div class="flex-1 sidebar-scroll overflow-y-auto py-4">
            <div class="px-4 mb-6">
                <button onclick="app.resetView()"
                    class="w-full flex items-center gap-3 px-3 py-2 text-white/90 bg-brand-purple rounded-lg hover:bg-brand-purple-dark transition-colors font-semibold">
                    <span class="material-symbols-outlined text-[20px]">add</span>
                    New Roadmap
                </button>
            </div>

            <nav class="px-2 space-y-1">
                <a href="#" class="flex items-center gap-3 px-3 py-2 text-white/80 rounded-md bg-white/5 font-medium">
                    <span class="material-symbols-outlined text-[20px]">dashboard</span>
                    Dashboard
                </a>
                <a href="#" onclick="app.showHistory()"
                    class="flex items-center gap-3 px-3 py-2 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-colors"
                    id="historyLink">
                    <span class="material-symbols-outlined text-[20px]">history</span>
                    History
                </a>
                <button onclick="app.toggleTheme()"
                    class="w-full flex items-center gap-3 px-3 py-2 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-colors group text-left">
                    <span class="material-symbols-outlined text-[20px] group-hover:text-brand-purple transition-colors"
                        id="themeIcon">dark_mode</span>
                    <span class="font-medium" id="themeText">Dark Mode</span>
                </button>
                <a href="#templates" onclick="app.showTemplates()"
                    class="flex items-center gap-3 px-3 py-2 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-colors">
                    <span class="material-symbols-outlined text-[20px]">folder_open</span>
                    Templates
                </a>
            </nav>

            <div class="mt-8 px-4">
                <h3 class="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Workspace</h3>
                <nav class="space-y-1">
                    <a href="#" onclick="app.showHistory()"
                        class="flex items-center gap-3 px-2 py-1.5 text-text-muted hover:text-white text-xs transition-colors">
                        <span class="w-2 h-2 rounded-full bg-success"></span>
                        Active Projects
                    </a>
                    <a href="#" onclick="app.showTemplates()"
                        class="flex items-center gap-3 px-2 py-1.5 text-text-muted hover:text-white text-xs transition-colors">
                        <span class="w-2 h-2 rounded-full bg-warning"></span>
                        Planning
                    </a>
                </nav>
            </div>
        </div>

        <!-- User Profile -->
        <div class="p-4 border-t border-white/5">
            <div id="authButtons" class="flex flex-col gap-2">
                <button onclick="app.showAuthModal()"
                    class="w-full py-2 px-4 border border-white/20 rounded-md text-white hover:bg-white/5 transition-colors text-xs font-bold">
                    Log In / Sign Up
                </button>
            </div>

            <div id="userMenu" class="hidden flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-brand-purple flex items-center justify-center text-white font-bold text-xs"
                    id="userAvatar">U</div>
                <div class="flex-1 overflow-hidden">
                    <p class="text-white text-xs font-semibold truncate" id="displayUsername">User</p>
                    <p class="text-text-muted text-[10px] truncate">Free Plan</p>
                </div>
                <button onclick="app.logout()" class="text-text-muted hover:text-white">
                    <span class="material-symbols-outlined text-[18px]">logout</span>
                </button>
            </div>
        </div>
    </aside>

    <!-- MAIN CONTENT -->
    <main
        class="flex-1 flex flex-col bg-white/80 dark:bg-slate-900/60 backdrop-blur-md overflow-hidden relative z-10 transition-colors duration-300">

        <!-- Header -->
        <header
            class="h-16 bg-surface border-b border-border-light flex items-center justify-between px-6 shrink-0 relative z-30">
            <div class="flex items-center gap-4">
                <h2 class="text-xl font-bold text-text-main" id="pageTitle">New Roadmap</h2>
            </div>
            <div class="flex items-center gap-3">
                <button
                    class="p-2 text-text-muted hover:text-brand-purple hover:bg-brand-purple/5 rounded-full transition-colors">
                    <span class="material-symbols-outlined text-[20px]">help</span>
                </button>
                <div class="relative">
                    <button onclick="app.toggleNotifications()"
                        class="p-2 text-text-muted hover:text-brand-purple hover:bg-brand-purple/5 rounded-full transition-colors relative">
                        <span class="material-symbols-outlined text-[20px]">notifications</span>
                        <span id="notificationBadge"
                            class="hidden absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border border-surface"></span>
                    </button>
                    <!-- Dropdown -->
                    <div id="notificationDropdown"
                        class="hidden absolute right-0 top-full mt-2 w-80 bg-surface border border-border-light rounded-xl shadow-lg z-50 overflow-hidden animate-fade-in">
                        <div class="p-3 border-b border-border-light flex justify-between items-center bg-gray-50/50">
                            <h4 class="text-xs font-bold text-text-main uppercase tracking-wider">Notifications</h4>
                            <button onclick="app.clearNotifications()"
                                class="text-[10px] text-brand-purple hover:underline font-bold">Clear All</button>
                        </div>
                        <div id="notificationList" class="max-h-64 overflow-y-auto">
                            <!-- Items populated by JS -->
                            <div class="p-4 text-center text-text-muted text-xs">No notifications yet</div>
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <!-- Content Srcollable -->
        <div class="flex-1 overflow-y-auto p-6 md:p-10 flex flex-col min-h-0 relative">

            <!-- VIEW 1: Input Form -->
            <div id="inputSection" class="w-full max-w-2xl mx-auto my-auto animate-fade-in shrink-0 relative z-20">
                <div class="bg-surface rounded-xl shadow-sm border border-border-light p-6 mb-8">
                    <h1 class="text-3xl font-extrabold text-text-main mb-3">What are we building today?</h1>
                    <p class="text-text-muted mb-8">Describe your project goal, requirements, and tech stack. The more
                        specific, the better.</p>

                    <div class="space-y-6">
                        <div>
                            <label class="block text-xs font-bold text-text-muted uppercase mb-2">Project
                                Description</label>
                            <textarea id="projectDesc" rows="4"
                                class="w-full bg-main-bg border-border-light rounded-lg p-4 text-text-main focus:ring-2 focus:ring-brand-purple focus:border-transparent transition-all font-medium resize-none placeholder:text-gray-400"
                                placeholder="e.g., A SaaS platform for veterinary clinics to manage appointments..."></textarea>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label class="block text-xs font-bold text-text-muted uppercase mb-2">Target
                                    Deadline</label>
                                <input type="date" id="deadline"
                                    class="w-full bg-main-bg border-border-light rounded-lg p-3 text-text-main focus:ring-2 focus:ring-brand-purple focus:border-transparent transition-all">
                            </div>
                            <div class="flex items-end">
                                <button id="generateBtn"
                                    class="w-full h-[46px] bg-brand-purple hover:bg-brand-purple-dark text-white font-bold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                                    <span class="material-symbols-outlined text-sm">auto_awesome</span>
                                    Generate Plan
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div
                        class="p-6 bg-surface rounded-xl border border-border-light flex flex-col items-center text-center">
                        <div
                            class="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center mb-3">
                            <span class="material-symbols-outlined">network_node</span>
                        </div>
                        <h4 class="font-bold text-text-main mb-1">Smart Phases</h4>
                        <p class="text-xs text-text-muted">Automatically breaks down projects into logical milestones.
                        </p>
                    </div>
                    <div
                        class="p-6 bg-surface rounded-xl border border-border-light flex flex-col items-center text-center">
                        <div
                            class="w-10 h-10 rounded-full bg-purple-50 text-brand-purple flex items-center justify-center mb-3">
                            <span class="material-symbols-outlined">psychology</span>
                        </div>
                        <h4 class="font-bold text-text-main mb-1">AI Insights</h4>
                        <p class="text-xs text-text-muted">Get specific technical advice for every single step.</p>
                    </div>
                    <div
                        class="p-6 bg-surface rounded-xl border border-border-light flex flex-col items-center text-center">
                        <div
                            class="w-10 h-10 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center mb-3">
                            <span class="material-symbols-outlined">warning</span>
                        </div>
                        <h4 class="font-bold text-text-main mb-1">Risk Analysis</h4>
                        <p class="text-xs text-text-muted">Identify potential bottlenecks before they happen.</p>
                    </div>
                </div>
            </div>

            <!-- VIEW 2: Templates Section (New) -->
            <div id="templatesSection" class="hidden max-w-6xl mx-auto animate-fade-in pb-20">
                <div class="flex items-center justify-between mb-8">
                    <div>
                        <h1 class="text-3xl font-extrabold text-text-main mb-2">Project Templates</h1>
                        <p class="text-text-muted">Choose a starting point for your next big idea.</p>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="templatesGrid">
                    <!-- Templates populated by JS -->
                </div>
            </div>

            <!-- VIEW 3: Premium Dark Loading Overlay (Fixed) -->
            <div id="loadingOverlay"
                class="hidden fixed inset-0 z-[60] flex-col items-center justify-center bg-[#101622]/95 backdrop-blur-md transition-all duration-500 dark">
                <div class="relative flex items-center justify-center mb-16">
                    <div class="absolute inset-0 bg-primary/20 blur-[80px] rounded-full w-80 h-80 animate-pulse"></div>
                    <div class="absolute inset-0 bg-purple-600/10 blur-[60px] rounded-full w-64 h-64 mix-blend-screen">
                    </div>
                    <div
                        class="absolute w-[280px] h-[280px] rounded-full border border-white/5 border-t-primary/40 border-r-primary/40 animate-[spin_4s_linear_infinite]">
                    </div>
                    <div
                        class="absolute w-[220px] h-[220px] rounded-full border border-white/5 border-b-purple-500/40 border-l-purple-500/40 animate-[spin_5s_linear_infinite_reverse]">
                    </div>
                    <div
                        class="absolute w-[180px] h-[180px] rounded-full border border-primary/20 bg-primary/5 animate-pulse">
                    </div>

                    <div
                        class="relative z-10 w-32 h-32 rounded-full bg-[#151b26] border border-white/10 flex items-center justify-center shadow-2xl overflow-hidden group">
                        <div
                            class="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:16px_16px]">
                        </div>
                        <div
                            class="absolute w-full h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent animate-scan z-20">
                        </div>
                        <span
                            class="material-symbols-outlined text-6xl text-transparent bg-clip-text bg-gradient-to-tr from-indigo-400 to-purple-400 relative z-30 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]">psychology</span>
                    </div>
                </div>

                <div class="flex flex-col items-center gap-6 text-center z-10 max-w-lg mx-auto px-6 font-display">
                    <div class="flex flex-col gap-2">
                        <h2
                            class="text-3xl md:text-4xl font-bold text-white tracking-tight flex items-center justify-center gap-2">
                            Generating Timeline
                        </h2>
                        <p class="text-slate-400 text-sm md:text-base font-medium">
                            <span class="text-primary">AI</span> is analyzing project parameters & estimating milestones
                        </p>
                    </div>
                    <div class="w-full max-w-xs flex flex-col gap-2">
                        <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
                            <div class="absolute inset-y-0 left-0 h-full w-1/2 bg-gradient-to-r from-indigo-500 via-primary to-purple-500 rounded-full animate-shimmer"
                                style="width: 60%">
                                <div class="absolute inset-0 bg-white/30 w-full h-full animate-pulse"></div>
                            </div>
                        </div>
                        <div class="flex justify-between text-xs text-slate-500 font-mono mt-1">
                            <span>PROCESSING_DATA</span>
                            <span>60%</span>
                        </div>
                    </div>

                    <!-- Dynamic Steps for effect -->
                    <div class="mt-8 flex flex-col gap-2 w-full max-w-xs opacity-80" id="loadingSteps">
                        <!-- Populated by JS -->
                    </div>
                </div>
            </div>

            <!-- VIEW 3: Results Timeline -->
            <div id="resultSection" class="hidden max-w-5xl mx-auto pb-20 animate-slide-up">

                <!-- Project Header -->
                <div
                    class="bg-surface rounded-xl border border-border-light p-6 mb-8 flex flex-col md:flex-row justify-between items-start gap-6 shadow-sm">
                    <div class="flex-1">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="w-2 h-2 rounded-full bg-green-500"></span>
                            <h1 class="text-2xl font-bold text-text-main" id="resProjectTitle">Project Title</h1>
                        </div>
                    </div>
                    <p class="text-text-muted leading-relaxed" id="resExecSummary">Summary...</p>
                </div>

                <div class="flex flex-col gap-3 shrink-0">
                    <div id="riskBanner"
                        class="hidden bg-orange-50 border border-orange-100 rounded-lg p-4 max-w-xs transition-all hover:shadow-md">
                        <div class="flex items-center gap-2 mb-1 text-orange-700 font-bold text-sm">
                            <span class="material-symbols-outlined text-[18px]">warning</span>
                            Risk Assessment
                        </div>
                        <p id="riskMessage" class="text-xs text-orange-800/80 leading-snug">Timeline is aggressive.</p>
                    </div>

                    <button onclick="app.exportTimeline()"
                        class="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-border-light rounded-lg text-text-main text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors group">
                        <span
                            class="material-symbols-outlined text-gra-400 group-hover:text-brand-purple">download</span>
                        Export Timeline
                    </button>
                </div>

                <!-- Timeline List (Moved Inside) -->
                <div class="relative pl-6 border-l-2 border-border-light ml-4 space-y-8 mt-8" id="timelineContainer">
                    <!-- Dynamic Cards Go Here -->
                </div>
            </div>

        </div>

    </main>

    <!-- PREMIUM DARK MODAL (PHASE DETAILS) -->
    <div id="modalOverlay"
        class="hidden fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-opacity duration-300 dark">
        <div
            class="glass-panel w-full max-w-[800px] max-h-[90vh] flex flex-col rounded-2xl overflow-hidden animate-in zoom-in-95 duration-300 font-display bg-[#0f172a] border border-white/10 shadow-2xl">
            <!-- Modal Header -->
            <div class="flex items-start justify-between p-6 border-b border-white/10 bg-white/[0.02]">
                <div class="flex flex-col gap-2">
                    <div class="flex items-center gap-3">
                        <span
                            class="px-2.5 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider border border-primary/20"
                            id="modalStatus">
                            Phase
                        </span>
                        <span class="flex items-center gap-1 text-xs text-slate-400">
                            <span class="material-symbols-outlined text-[16px]">calendar_today</span>
                            <span id="modalDuration">2 Weeks</span>
                        </span>
                    </div>
                    <h2 class="text-white text-2xl font-bold leading-tight tracking-[-0.015em]" id="modalTitle">
                        Phase
                        Title</h2>
                </div>
                <button onclick="app.closeModal()"
                    class="text-slate-400 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <!-- Modal Content (Scrollable) -->
            <div class="flex-1 overflow-y-auto custom-scrollbar">
                <div class="p-6 flex flex-col gap-8">

                    <!-- AI Insight Box -->
                    <div class="relative group">
                        <div
                            class="absolute -inset-0.5 bg-gradient-to-r from-pink-500 via-purple-500 to-primary rounded-xl opacity-75 blur-sm group-hover:opacity-100 transition duration-500">
                        </div>
                        <div class="relative flex items-start gap-4 p-5 bg-[#101622] rounded-xl border border-white/10">
                            <div
                                class="bg-gradient-to-br from-indigo-500 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg">
                                <span class="material-symbols-outlined text-white text-[20px]">smart_toy</span>
                            </div>
                            <div class="flex flex-col gap-1.5 flex-1">
                                <div class="flex justify-between items-center w-full">
                                    <p
                                        class="text-xs font-bold uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
                                        AI Insight</p>
                                    <span class="text-[10px] text-slate-500">Just now</span>
                                </div>
                                <p class="text-sm text-slate-300 leading-relaxed" id="modalInsight">
                                    Insight goes here...
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Tasks -->
                    <div class="flex flex-col gap-4">
                        <div class="flex items-center justify-between">
                            <h3 class="text-lg font-bold text-white">Action Items</h3>
                            <button onclick="app.checkAllTasks()"
                                class="text-xs font-bold text-primary hover:text-white uppercase tracking-wider transition-colors">
                                Check All
                            </button>
                        </div>
                        <div class="flex flex-col divide-y divide-white/5 border border-white/10 rounded-xl bg-[#151b26]/50 overflow-hidden"
                            id="modalTasksList">
                            <!-- Tasks populated by JS -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Footer -->
            <div class="p-6 border-t border-white/10 bg-white/[0.02] flex justify-end gap-3">
                <button onclick="app.closeModal()"
                    class="px-5 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors">
                    Close
                </button>
            </div>
        </div>
    </div>

    <!-- AUTH MODAL -->
    <div id="authModal"
        class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div class="bg-surface w-full max-w-sm rounded-xl shadow-2xl overflow-hidden p-8 animate-slide-up">
            <div class="text-center mb-6">
                <div
                    class="w-12 h-12 bg-brand-purple rounded-lg flex items-center justify-center mx-auto mb-4 text-white">
                    <span class="material-symbols-outlined text-2xl">lock</span>
                </div>
                <h2 class="text-2xl font-bold text-text-main mb-1" id="authTitle">Welcome Back</h2>
                <p class="text-text-muted text-sm" id="authSubtitle">Login to access your projects.</p>
            </div>

            <div class="space-y-4">
                <a href="/google/login"
                    class="w-full h-10 rounded-lg border border-border-light bg-white hover:bg-gray-50 flex items-center justify-center gap-2 text-text-main font-bold transition-all shadow-sm">
                    <img src="https://www.google.com/favicon.ico" alt="Google" class="w-4 h-4">
                    Sign in with Google
                </a>

                <div class="relative flex items-center py-2">
                    <div class="flex-grow border-t border-border-light"></div>
                    <span class="flex-shrink-0 mx-4 text-xs text-text-muted font-bold uppercase">Or</span>
                    <div class="flex-grow border-t border-border-light"></div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-text-muted uppercase mb-1">Username</label>
                    <input type="text" id="authUsername"
                        class="w-full bg-main-bg border border-border-light rounded-lg p-3 text-text-main focus:ring-2 focus:ring-brand-purple focus:border-transparent transition-all">
                </div>
                <div>
                    <label class="block text-xs font-bold text-text-muted uppercase mb-1">Password</label>
                    <input type="password" id="authPassword"
                        class="w-full bg-main-bg border border-border-light rounded-lg p-3 text-text-main focus:ring-2 focus:ring-brand-purple focus:border-transparent transition-all">
                </div>

                <button id="authActionBtn"
                    class="w-full h-10 rounded-lg bg-brand-purple hover:bg-brand-purple-dark text-white font-bold transition-all shadow-md">
                    Log In
                </button>

                <div class="text-center pt-2">
                    <button id="authToggleBtn" class="text-xs text-brand-purple font-bold hover:underline">
                        Don't have an account? Sign Up
                    </button>
                    <button onclick="app.closeAuthModal()"
                        class="block w-full mt-3 text-xs text-text-muted hover:text-text-main">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    </div>




    <!-- HISTORY MODAL -->
    <div id="historyModal"
        class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div
            class="bg-surface w-full max-w-2xl rounded-xl shadow-2xl border border-border-light flex flex-col max-h-[85vh] animate-slide-up">
            <div class="flex items-center justify-between p-6 border-b border-border-light">
                <h2 class="text-lg font-bold text-text-main">Workspace History</h2>
                <button onclick="app.closeHistoryModal()" class="text-text-muted hover:text-text-main">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto p-6 bg-main-bg">
                <div id="historyList" class="space-y-3">
                    <!-- Dynamic -->
                </div>
            </div>
        </div>
    </div>

    <!-- JS -->
    <script src="{{ url_for('static', filename='js/app.js') }}"></script>
    <script src="{{ url_for('static', filename='js/animations.js') }}"></script>
</body>

</html>
```

### templates\timeline.html

```html
<!DOCTYPE html>
<html class="dark" lang="en">

<head>
    <meta charset="utf-8" />
    <meta content="width=device-width, initial-scale=1.0" name="viewport" />
    <title>AI Project Timeline Generator</title>

    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com" rel="preconnect" />
    <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect" />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&amp;display=swap"
        rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

    <!-- Material Symbols -->
    <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap"
        rel="stylesheet" />

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#141414",
                        "primary-dark": "#ffffff",
                        "accent-blue": "#3b82f6",
                        "accent-purple": "#8b5cf6",
                        "background-dark": "#0f172a", /* Deep SaaS Blue/Black */
                        "surface-dark": "#1e293b",
                        "text-main-dark": "#f8fafc",
                        "text-muted-dark": "#94a3b8",
                        "border-dark": "#334155",
                    },
                    fontFamily: {
                        "display": ["Plus Jakarta Sans", "sans-serif"],
                        "body": ["Inter", "sans-serif"]
                    },
                    animation: {
                        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                    }
                },
            },
        }
    </script>

    <!-- Custom CSS -->
    <link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}">
</head>

<body
    class="font-body bg-background-dark text-text-main-dark antialiased selection:bg-accent-blue selection:text-white overflow-x-hidden">

    <div class="relative flex h-auto min-h-screen w-full flex-col">

        <!-- Background Gradient Orb -->
        <div class="fixed top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl opacity-20 pointer-events-none z-0">
            <div
                class="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-accent-blue rounded-full mix-blend-screen filter blur-[100px] animate-pulse-slow">
            </div>
            <div class="absolute top-[20%] right-[10%] w-[400px] h-[400px] bg-accent-purple rounded-full mix-blend-screen filter blur-[100px] animate-pulse-slow"
                style="animation-delay: 2s;"></div>
        </div>

        <!-- Header -->
        <header class="sticky top-0 z-50 glass-panel border-b border-white/5 px-6 py-4">
            <div class="mx-auto max-w-7xl flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div
                        class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple text-white shadow-lg shadow-accent-blue/20">
                        <span class="material-symbols-outlined text-2xl">neurology</span>
                    </div>
                    <div>
                        <h1 class="text-xl font-bold tracking-tight text-white">NeuroPlan AI</h1>
                        <span class="text-[10px] uppercase tracking-widest text-accent-blue font-bold">Concept
                            v1.0</span>
                    </div>
                </div>

                <div class="hidden md:flex items-center gap-2">
                    <a href="#"
                        class="px-4 py-2 text-sm font-medium text-text-muted-dark hover:text-white transition-colors">Documentation</a>
                    <div class="w-px h-4 bg-white/10 mx-2"></div>
                    <span
                        class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-emerald-400">
                        <span class="relative flex h-2 w-2">
                            <span
                                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Systems Normal
                    </span>
                </div>
            </div>
        </header>

        <main class="flex-1 relative z-10">
            <!-- Hero & Input Section -->
            <section class="py-16 md:py-24 px-6">
                <div class="mx-auto max-w-3xl text-center flex flex-col items-center gap-8">

                    <h2
                        class="text-5xl md:text-7xl font-display font-black leading-tight tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 pb-2">
                        Architect Your <br /> Future.
                    </h2>
                    <p class="text-lg text-text-muted-dark max-w-xl leading-relaxed">
                        Harness our neural engine to decompose complex project goals into actionable, risk-assessed
                        timelines in milliseconds.
                    </p>

                    <!-- Input Card (Glassmorphism) -->
                    <div class="w-full mt-8 p-1 rounded-2xl bg-gradient-to-b from-white/10 to-transparent">
                        <div
                            class="glass-panel rounded-xl p-8 border border-white/10 shadow-2xl backdrop-blur-xl relative overflow-hidden group">

                            <!-- Input Glow Effect -->
                            <div
                                class="absolute inset-0 bg-gradient-to-tr from-accent-blue/10 to-accent-purple/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
                            </div>

                            <div class="flex flex-col gap-6 relative z-10 text-left">
                                <div>
                                    <label for="projectDesc"
                                        class="block text-sm font-medium text-text-muted-dark mb-2">Project
                                        Vision</label>
                                    <textarea id="projectDesc" rows="3"
                                        class="w-full bg-black/20 border border-white/10 rounded-lg p-4 text-white placeholder:text-white/20 focus:ring-2 focus:ring-accent-blue focus:border-transparent transition-all resize-none font-sans"
                                        placeholder="e.g. Develop a scalable RAG chatbot for legal contract analysis..."></textarea>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label for="deadline"
                                            class="block text-sm font-medium text-text-muted-dark mb-2">Target
                                            Deadline</label>
                                        <input type="date" id="deadline"
                                            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-white focus:ring-2 focus:ring-accent-blue focus:border-transparent transition-all [color-scheme:dark]">
                                    </div>
                                    <div class="flex items-end">
                                        <button id="generateBtn"
                                            class="w-full h-[46px] rounded-lg bg-white text-black font-bold text-sm hover:bg-gray-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] active:scale-[0.98] flex items-center justify-center gap-2">
                                            <span class="material-symbols-outlined text-[20px]">psychology</span>
                                            <span>Generate AI Strategy</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Loading Overlay (Hidden by Default) -->
            <div id="loadingOverlay"
                class="hidden fixed inset-0 z-[60] bg-background-dark/80 backdrop-blur-sm flex items-center justify-center">
                <div class="flex flex-col items-center gap-6">
                    <!-- Neural Brain Animation (CSS) -->
                    <div class="neural-loader relative w-24 h-24">
                        <div
                            class="absolute inset-0 rounded-full border-4 border-accent-blue/30 animate-[spin_3s_linear_infinite]">
                        </div>
                        <div
                            class="absolute inset-2 rounded-full border-4 border-accent-purple/30 animate-[spin_4s_linear_infinite_reverse]">
                        </div>
                        <div
                            class="absolute inset-0 m-auto w-12 h-12 bg-gradient-to-br from-accent-blue to-accent-purple rounded-full animate-pulse shadow-[0_0_30px_rgba(59,130,246,0.6)]">
                        </div>
                    </div>
                    <div class="text-center">
                        <h3 class="text-xl font-bold text-white mb-1">Synthesizing Neural Pathways</h3>
                        <p class="text-sm text-accent-blue animate-pulse">Analyzing constraints & dependencies...</p>
                    </div>
                </div>
            </div>

            <!-- Results Section (Hidden by Default) -->
            <section id="resultSection" class="hidden py-12 px-6 pb-36">
                <div class="mx-auto max-w-5xl">

                    <!-- Risk Assessment Banner -->
                    <div id="riskBanner"
                        class="mb-12 p-1 rounded-xl bg-gradient-to-r from-orange-500/50 to-red-500/50 hidden">
                        <div class="bg-surface-dark/90 backdrop-blur rounded-lg p-4 flex items-start gap-4">
                            <span class="material-symbols-outlined text-orange-400 text-3xl">warning</span>
                            <div>
                                <h4 class="text-lg font-bold text-white mb-1">Risk Assessment Protocol</h4>
                                <p id="riskMessage" class="text-sm text-gray-300">Timeline appears aggressive based on
                                    historical data.</p>
                                <div class="mt-2 text-xs font-mono text-orange-300" id="riskMitigation">>> Mitigation:
                                    Reduce feature scope by 20%</div>
                            </div>
                        </div>
                    </div>

                    <!-- Executive Summary -->
                    <div class="mb-12 text-center fade-in-up">
                        <h2 class="text-3xl font-bold text-white mb-4" id="projectTitle">Project Title</h2>
                        <p class="text-text-muted-dark max-w-2xl mx-auto" id="execSummary">Summary goes here...</p>

                        <button id="exportBtn"
                            class="mt-6 px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-sm text-text-muted-dark hover:text-white flex items-center gap-2 mx-auto">
                            <span class="material-symbols-outlined text-[18px]">content_copy</span>
                            Copy to Clipboard
                        </button>
                    </div>

                    <!-- Vertical Timeline -->
                    <div class="relative pl-0 md:pl-0" id="timelineContainer">
                        <!-- Central Line -->
                        <div
                            class="absolute left-6 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-accent-blue via-accent-purple to-transparent -translate-x-1/2 md:translate-x-0 opacity-30">
                        </div>

                        <!-- Dynamic Cards will be injected here -->

                    </div>
                </div>
            </section>

        </main>

        <!-- Footer -->
        <footer class="border-t border-white/5 py-8 px-6 bg-surface-dark relative z-10">
            <div class="mx-auto max-w-7xl flex justify-between items-center text-xs text-white/20">
                <p>ENGINE: V1.3.4 // MOCK_MODE_ACTIVE</p>
                <p>© 2025 NEUROPLAN AI</p>
            </div>
        </footer>

    </div>

    <!-- JavaScript -->
    <script src="{{ url_for('static', filename='js/app.js') }}"></script>
</body>

</html>
```

