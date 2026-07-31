import os
import base64
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

with open("/home/adithya/Downloads/Antigravity IDE/Voice/static/audio/1e0ab85c-6628-4588-a756-545af228be0a/speaker_SPEAKER_00_beeped.wav", "rb") as f:
    audio_b64 = base64.b64encode(f.read()).decode('utf-8')

try:
    rx = client.chat.completions.create(
        model="gpt-4o-audio-preview",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Analyze the primary emotion, confidence, and frustration in this audio. Return JSON format."
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_b64,
                            "format": "wav"
                        }
                    }
                ]
            }
        ],
        response_format={"type": "json_object"},
        max_tokens=200
    )
    print(rx.choices[0].message.content)
except Exception as e:
    print(f"ERROR: {e}")
