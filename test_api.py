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
