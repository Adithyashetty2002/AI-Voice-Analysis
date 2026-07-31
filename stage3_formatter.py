import logging

logger = logging.getLogger("stage3_formatter")

def format_speaker_turns(transcribed_turns: list, total_audio_duration: float) -> dict:
    """
    Formats individual speaker turns:
    - Calculates duration and WPM per turn.
    - Calculates overall metrics: speaker floor share, words per minute, and word counts.
    - Strictly avoids any turn/text/audio concatenation.
    """
    logger.info("Formatting speaker turns and calculating conversational metrics...")
    
    formatted_turns = []
    speaker_durations = {}
    speaker_word_counts = {}
    
    for turn in transcribed_turns:
        text = turn["text"]
        words = text.split()
        num_words = len(words)
        
        # Calculate WPM for this turn (words per minute)
        duration = turn["duration_seconds"]
        wpm = 0.0
        if duration > 0:
            wpm = round(num_words / (duration / 60.0), 1)
            
        formatted_turns.append({
            "speaker": turn["speaker"],
            "turn_start": turn["turn_start"],
            "turn_end": turn["turn_end"],
            "duration_seconds": duration,
            "words_per_minute": wpm,
            "text": text,
            "voice_clip_url": turn["voice_clip_url"],
            "raw_word_timestamps": turn["raw_word_timestamps"]
        })
        
        # Aggregate stats per speaker
        spk = turn["speaker"]
        speaker_durations[spk] = speaker_durations.get(spk, 0.0) + duration
        speaker_word_counts[spk] = speaker_word_counts.get(spk, 0) + num_words

    # Calculate overall speaker statistics
    speaker_stats = {}
    total_talking_time = sum(speaker_durations.values())
    
    for spk in speaker_durations:
        spk_duration = round(speaker_durations[spk], 2)
        spk_words = speaker_word_counts[spk]
        
        # Floor share percentage relative to the TOTAL audio duration
        floor_share = 0.0
        if total_audio_duration > 0:
            floor_share = round((spk_duration / total_audio_duration) * 100, 1)
            
        # Overall WPM for this speaker
        overall_wpm = 0.0
        if spk_duration > 0:
            overall_wpm = round(spk_words / (spk_duration / 60.0), 1)
            
        speaker_stats[spk] = {
            "speaker": spk,
            "total_talking_time_seconds": spk_duration,
            "total_words": spk_words,
            "floor_share_percentage": floor_share,
            "overall_wpm": overall_wpm
        }

    return {
        "turns": formatted_turns,
        "metrics": {
            "total_audio_duration_seconds": round(total_audio_duration, 2),
            "total_talking_duration_seconds": round(total_talking_time, 2),
            "speaker_statistics": speaker_stats
        }
    }
