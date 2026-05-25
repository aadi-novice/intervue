"""Tests for the transcript parser module.

The parser expects this format:
    0:00 - SpeakerName
    Text content here
    1:30 - OtherSpeaker
    More text here

The header line (timestamp - speaker) is followed by the text content
on subsequent lines, until the next header line or end of text.
"""

from app.ai.transcript_parser import chunk_transcript


class TestChunkTranscript:
    def test_empty_transcript(self):
        """An empty transcript should produce no chunks."""
        assert chunk_transcript("") == []

    def test_single_chunk(self):
        text = (
            "0:00 - Interviewer\n"
            "Hello and welcome.\n"
        )
        chunks = chunk_transcript(text)
        assert len(chunks) == 1
        assert chunks[0]["timestamp"] == "0:00"
        assert chunks[0]["speaker"] == "Interviewer"
        assert chunks[0]["text"] == "Hello and welcome."

    def test_multiple_chunks(self):
        text = (
            "0:00 - Interviewer\n"
            "Hello.\n"
            "1:15 - Candidate\n"
            "Hi there.\n"
            "3:30 - Interviewer\n"
            "Tell me about yourself.\n"
        )
        chunks = chunk_transcript(text)
        assert len(chunks) == 3

        assert chunks[0]["timestamp"] == "0:00"
        assert chunks[0]["speaker"] == "Interviewer"
        assert chunks[0]["text"] == "Hello."

        assert chunks[1]["timestamp"] == "1:15"
        assert chunks[1]["speaker"] == "Candidate"
        assert chunks[1]["text"] == "Hi there."

        assert chunks[2]["timestamp"] == "3:30"
        assert chunks[2]["speaker"] == "Interviewer"
        assert chunks[2]["text"] == "Tell me about yourself."

    def test_long_formatted_timestamps(self):
        """Timestamps like '10:23' or '1:05' should both be parsed."""
        text = (
            "10:23 - Interviewer\n"
            "Question?\n"
            "12:45 - Candidate\n"
            "Answer.\n"
        )
        chunks = chunk_transcript(text)
        assert len(chunks) == 2
        assert chunks[0]["timestamp"] == "10:23"
        assert chunks[1]["timestamp"] == "12:45"

    def test_chunk_text_multiline(self):
        """The text portion should include all lines until the next timestamp."""
        text = (
            "0:00 - Speaker\n"
            "Line one.\n"
            "Still line one.\n"
            "1:00 - Other\n"
            "Line two.\n"
        )
        chunks = chunk_transcript(text)
        assert len(chunks) == 2
        assert chunks[0]["text"] == "Line one.\nStill line one."
        assert chunks[1]["text"] == "Line two."

    def test_no_matching_pattern(self):
        """Transcript without the timestamp pattern should produce no chunks."""
        text = "This is just a plain text without timestamps.\nNo structured format."
        assert chunk_transcript(text) == []

    def test_speaker_name_with_parentheses(self):
        """Speaker name should be extracted from text in parentheses."""
        text = (
            "0:00 - Candidate(Alice Smith)\n"
            "Hello.\n"
        )
        chunks = chunk_transcript(text)
        assert len(chunks) == 1
        assert chunks[0]["speaker"] == "Candidate"
        assert chunks[0]["text"] == "Hello."

    def test_realistic_transcript(self):
        text = (
            "0:00 - Interviewer(John)\n"
            "Welcome to the interview. Can you start by introducing yourself?\n"
            "0:15 - Candidate(Alice)\n"
            "Sure! I'm Alice, a software engineer with 5 years of experience.\n"
            "1:30 - Interviewer(John)\n"
            "Great. Let's talk about your experience with Python.\n"
            "2:45 - Candidate(Alice)\n"
            "I've been using Python professionally for about 4 years.\n"
        )
        chunks = chunk_transcript(text)
        assert len(chunks) == 4
        assert chunks[0]["speaker"] == "Interviewer"
        assert "introducing yourself" in chunks[0]["text"]
        assert chunks[1]["speaker"] == "Candidate"
        assert "5 years of experience" in chunks[1]["text"]
        assert chunks[3]["text"] == "I've been using Python professionally for about 4 years."
