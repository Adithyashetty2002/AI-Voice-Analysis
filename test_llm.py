import json
import base64
from openai import OpenAI
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Use the actual beeped audio file
audio_path = "/home/adithya/Downloads/Antigravity IDE/Voice/data/sessions/aad238a6-91db-4356-a0b4-6d46638fb619_beeped_input.wav"
with open(audio_path, "rb") as f:
    base64_audio = base64.b64encode(f.read()).decode("utf-8")

sys_prompt = "Return JSON"
user_prompt = "Test"

try:
    messages = [
        {"role": "user", "content": [
            {"type": "text", "text": "Can you hear this?"},
            {
                "type": "input_audio",
                "input_audio": {
                    "data": base64_audio,
                    "format": "wav"
                }
            }
        ]}
    ]
    r1 = client.chat.completions.create(
        model="gpt-4o-audio-preview",
        modalities=["text"],
        messages=messages,
        temperature=0.1
    )
    print(r1.choices[0].message.content)
except Exception as e:
    print("ERROR:", e)
