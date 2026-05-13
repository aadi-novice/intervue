import re


def chunk_transcript(transcript_text: str) -> list[dict]:

    pattern = r"(\d{1,2}:\d{2})\s*-\s*(.+?)\n"

    matches = list(re.finditer(pattern, transcript_text))

    chunks = []

    for i in range(len(matches)):

        current_match = matches[i]

        start = current_match.end()

        end = matches[i + 1].start() if i + 1 < len(matches) else len(transcript_text)

        timestamp = current_match.group(1)
        speaker = current_match.group(2).split("(")[0].strip()
        text = transcript_text[start:end].strip()

        if text:
            chunks.append({
                "timestamp": timestamp,
                "speaker": speaker,
                "text": text
            })

    return chunks
