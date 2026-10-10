from app.services.speaker_alignment import TSeg, Word, align, build_timeline, clean_name


def W(start, end, word):
    return Word(start, end, word)


class TestTimeline:
    def test_spans_cover_until_next_event_and_total(self):
        tl = build_timeline([(0, "Priya"), (5000, "Alex")], total_ms=9000)
        assert tl == [(0, 5000, "Priya"), (5000, 9000, "Alex")]

    def test_flicker_is_absorbed_into_previous_speaker(self):
        tl = build_timeline([(0, "Priya"), (3000, "Alex"), (3200, "Priya"), (8000, "Alex")], total_ms=10000)
        # the 200ms Alex blip at 3000 must not create a turn
        assert [(a, b, n) for a, b, n in tl] == [(0, 8000, "Priya"), (8000, 10000, "Alex")]

    def test_clean_name_strips_meet_suffixes(self):
        assert clean_name("Alex Doe (You)") == "Alex Doe"
        assert clean_name("  Priya   Sharma ") == "Priya Sharma"
        assert clean_name("") == "Unknown"

    def test_unsorted_events_are_sorted(self):
        tl = build_timeline([(5000, "B"), (0, "A")], 6000)
        assert tl[0][2] == "A"


class TestAlignment:
    EVENTS = [(0, "Priya Sharma"), (5000, "Alex Doe")]

    def test_segment_level_uses_largest_overlap(self):
        segs = [TSeg(0, 4800, "Tell me about Rust"), TSeg(5200, 9000, "I built a compiler")]
        out = align(segs, self.EVENTS, 9000)
        assert [(a.speaker_label, a.text) for a in out] == [
            ("Priya Sharma", "Tell me about Rust"),
            ("Alex Doe", "I built a compiler"),
        ]

    def test_segment_straddling_a_turn_goes_to_larger_overlap(self):
        out = align([TSeg(3000, 8000, "mostly Alex")], self.EVENTS, 9000)
        assert out[0].speaker_label == "Alex Doe"  # 2s overlap with Priya, 3s with Alex

    def test_word_level_splits_a_segment_at_the_speaker_change(self):
        seg = TSeg(3000, 7000, "and then yes sure", words=[
            W(3000, 3500, " and"), W(3500, 4000, " then"),   # Priya (< 5000)
            W(5200, 5600, " yes"), W(5600, 6000, " sure"),   # Alex
        ])
        out = align([seg], self.EVENTS, 9000)
        assert [(a.speaker_label, a.text) for a in out] == [
            ("Priya Sharma", "and then"),
            ("Alex Doe", "yes sure"),
        ]
        assert (out[1].start_ms, out[1].end_ms) == (5200, 6000)

    def test_consecutive_same_speaker_segments_merge(self):
        segs = [TSeg(0, 1500, "Hello"), TSeg(1600, 3000, "welcome")]
        out = align(segs, self.EVENTS, 9000)
        assert len(out) == 1 and out[0].text == "Hello welcome"

    def test_no_events_means_unknown_single_speaker(self):
        out = align([TSeg(0, 1000, "hi"), TSeg(1000, 2000, "there")], [], 2000)
        assert [a.speaker_label for a in out] == ["Unknown"] and out[0].text == "hi there"

    def test_time_before_first_event_is_unknown(self):
        out = align([TSeg(0, 900, "early words", words=[W(0, 400, " early"), W(400, 900, " words")])],
                    [(2000, "Priya")], 5000)
        assert out[0].speaker_label == "Unknown"

    def test_empty_text_segments_are_dropped(self):
        assert align([TSeg(0, 100, "   ")], self.EVENTS, 1000) == []
