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
