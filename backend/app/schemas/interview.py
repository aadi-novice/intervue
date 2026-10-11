from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["google_meet", "teams", "zoom", "jitsi", "upload"]
ParticipantKind = Literal["interviewer", "candidate", "other"]
SpeakerKind = Literal["interviewer", "candidate", "unknown"]


class ParticipantIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    email: str | None = None
    user_id: int | None = None
    kind: ParticipantKind = "interviewer"


class InterviewCreate(BaseModel):
    candidate_id: int
    role_id: int | None = None
    title: str = Field(min_length=1, max_length=200)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    meeting_url: str | None = Field(default=None, max_length=2000)
    platform: Platform | None = None  # detected from meeting_url when omitted
    participants: list[ParticipantIn] = []


class ParticipantOut(BaseModel):
    id: int
    user_id: int | None = None
    display_name: str
    email: str | None = None
    kind: str

    model_config = {"from_attributes": True}


class BotSessionOut(BaseModel):
    id: int
    status: str
    failure_reason: str | None = None
    failure_detail: str | None = None
    joined_at: datetime | None = None
    left_at: datetime | None = None
    consent_message_sent_at: datetime | None = None

    model_config = {"from_attributes": True}


class NotesOut(BaseModel):
    summary: str
    key_points: list = []
    topics: list = []
    follow_ups: list = []

    model_config = {"from_attributes": True}


class InterviewSummary(BaseModel):
    id: int
    candidate_id: int
    candidate_name: str
    role_id: int | None = None
    role_name: str | None = None
    title: str
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    meeting_url: str | None = None
    platform: str
    status: str
    bot_status: str | None = None
    transcript_purged: bool = False  # recordings/transcript removed by the retention policy
    created_at: datetime


class InterviewDetail(InterviewSummary):
    participants: list[ParticipantOut] = []
    bot_session: BotSessionOut | None = None
    notes: NotesOut | None = None
    segment_count: int = 0
    has_recording: bool = False
    analysis_status: str = "none"  # none|queued|running|completed|failed
    analysis_id: int | None = None
    speakers: list["SpeakerSummary"] = []


class SpeakerSummary(BaseModel):
    speaker_label: str
    speaker_kind: str
    participant_id: int | None = None
    segment_count: int


InterviewDetail.model_rebuild()


class SegmentOut(BaseModel):
    id: int
    speaker_label: str
    speaker_kind: str
    participant_id: int | None = None
    start_ms: int
    end_ms: int
    text: str
    position: int

    model_config = {"from_attributes": True}


class SegmentPage(BaseModel):
    items: list[SegmentOut]
    total: int
    offset: int
    limit: int


class SpeakerMapping(BaseModel):
    speaker_label: str
    participant_id: int | None = None
    kind: SpeakerKind | None = None


class SpeakerMappingRequest(BaseModel):
    mappings: list[SpeakerMapping] = Field(min_length=1)


class RecordingUrl(BaseModel):
    url: str
    expires_in: int
    mime_type: str
    duration_ms: int | None = None


class BotRequest(BaseModel):
    mode: Literal["now", "scheduled"] = "now"


class RecordingUploadRequest(BaseModel):
    content_type: str


class RecordingUploadResponse(BaseModel):
    upload_url: str
    key: str
    headers: dict[str, str]
    max_bytes: int


class RecordingUploadComplete(BaseModel):
    key: str
