import requests
import os
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("SMALLEST_AI_API_KEY")
print("Key length:", len(key) if key else 0)

# create a dummy wav file
from pydub import AudioSegment
from pydub.generators import Sine
audio = Sine(1000).to_audio_segment(duration=1000, volume=0.0)
audio.export("dummy.wav", format="wav")

url = "https://api.smallest.ai/waves/v1/stt/?model=pulse&language=en&emotion_detection=true"
headers = {
    "Authorization": f"Bearer {key}",
    "Content-Type": "audio/wav"
}

with open("dummy.wav", "rb") as f:
    resp = requests.post(url, headers=headers, data=f.read())
print(resp.status_code)
print(resp.text)
