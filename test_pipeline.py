from stage1_diarization import preprocess_audio
import os
import unittest
import numpy as np
import soundfile as sf
from pydub import AudioSegment
from stage3_formatter import format_speaker_turns
from stage4_scorer import generate_mock_scorecard

class TestVoiceAnalysisPipeline(unittest.TestCase):
    def setUp(self):
        # Create a dummy audio file for testing
        self.test_audio_path = "test_input.wav"
        self.output_wav_path = "test_normalized.wav"
        
        # Generate 2 seconds of silence (16kHz, mono, 16-bit PCM)
        samplerate = 16000
        data = np.zeros(samplerate * 2, dtype=np.int16)
        sf.write(self.test_audio_path, data, samplerate, subtype='PCM_16')

    def tearDown(self):
        # Clean up files created during tests
        for f in [self.test_audio_path, self.output_wav_path]:
            if os.path.exists(f):
                os.remove(f)

    def test_ffmpeg_preprocessing(self):
        """
        Tests that FFmpeg successfully transcodes audio to Mono 16kHz WAV and normalizes loudness.
        """
        preprocess_audio(self.test_audio_path, self.output_wav_path)
        
        self.assertTrue(os.path.exists(self.output_wav_path))
        
        # Load and verify properties using pydub/soundfile
        audio = AudioSegment.from_wav(self.output_wav_path)
        self.assertEqual(audio.channels, 1)        # Mono
        self.assertEqual(audio.frame_rate, 16000)   # 16kHz
        self.assertAlmostEqual(len(audio) / 1000.0, 2.0, places=1) # ~2 seconds

    def test_turn_formatter(self):
        """
        Tests Stage 3 turn formatting and speaker floor share metric calculations.
        """
        mock_raw_turns = [
            {
                "speaker": "SPEAKER_00",
                "turn_start": 0.0,
                "turn_end": 2.0,
                "duration_seconds": 2.0,
                "text": "Hello world this is a test",
                "voice_clip_url": "/static/audio/dummy1.wav",
                "raw_word_timestamps": []
            },
            {
                "speaker": "SPEAKER_01",
                "turn_start": 2.0,
                "turn_end": 4.0,
                "duration_seconds": 2.0,
                "text": "Yes indeed it works",
                "voice_clip_url": "/static/audio/dummy2.wav",
                "raw_word_timestamps": []
            }
        ]
        
        result = format_speaker_turns(mock_raw_turns, total_audio_duration=4.0)
        
        # Verify turns format
        self.assertEqual(len(result["turns"]), 2)
        self.assertEqual(result["turns"][0]["words_per_minute"], 180.0) # 6 words / (2s / 60s) = 180
        
        # Verify speaker metrics
        stats = result["metrics"]["speaker_statistics"]
        self.assertIn("SPEAKER_00", stats)
        self.assertIn("SPEAKER_01", stats)
        self.assertEqual(stats["SPEAKER_00"]["floor_share_percentage"], 50.0) # 2s / 4s = 50%
        self.assertEqual(stats["SPEAKER_01"]["floor_share_percentage"], 50.0)

    def test_mock_scorecard_generation(self):
        """
        Tests fallback topic evaluation when LLM credentials are not configured.
        """
        mock_turns = [
            {"speaker": "SPEAKER_00", "text": "Hello world"}
        ]
        scorecard = generate_mock_scorecard(mock_turns, "test topic")
        
        self.assertEqual(scorecard["topic"], "test topic")
        self.assertEqual(len(scorecard["speaker_scorecards"]), 1)
        self.assertEqual(scorecard["speaker_scorecards"][0]["speaker"], "SPEAKER_00")

    def test_funasr_diarization(self):
        """
        Tests that FunASR Diarization (VAD & CAM++ clustering) runs and segments audio.
        """
        samplerate = 16000
        t = np.linspace(0, 4.0, samplerate * 4, endpoint=False)
        y = np.zeros(samplerate * 4)
        y[int(samplerate * 0.5):int(samplerate * 1.5)] = np.sin(2 * np.pi * 440 * t[int(samplerate * 0.5):int(samplerate * 1.5)])
        y[int(samplerate * 2.5):int(samplerate * 3.5)] = np.sin(2 * np.pi * 880 * t[int(samplerate * 2.5):int(samplerate * 3.5)])
        
        test_wav = "test_diarization.wav"
        sf.write(test_wav, y, samplerate, subtype='PCM_16')
        
        try:
            from stage1_diarization import DiarizationPipeline
            pipeline = DiarizationPipeline(device="cpu")
            turns = pipeline.run(test_wav)
            
            self.assertTrue(len(turns) >= 1)
            for turn in turns:
                self.assertIn("start", turn)
                self.assertIn("end", turn)
                self.assertIn("speaker", turn)
                self.assertTrue(isinstance(turn["speaker"], str))
                self.assertTrue(turn["speaker"].startswith("SPEAKER_"))
        finally:
            if os.path.exists(test_wav):
                os.remove(test_wav)

if __name__ == "__main__":
    unittest.main()
