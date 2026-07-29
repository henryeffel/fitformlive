from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GroundTruth(BaseModel):
    attemptedReps: int = Field(ge=0)
    completeReps: int = Field(ge=0)

    @model_validator(mode="after")
    def completed_cannot_exceed_attempted(self) -> "GroundTruth":
        if self.completeReps > self.attemptedReps:
            raise ValueError("completeReps cannot exceed attemptedReps")
        return self


class AlgorithmVersion(BaseModel):
    commit: str = Field(min_length=1)
    dirty: bool
    module: str = Field(min_length=1)


class InitialAlgorithmState(BaseModel):
    phase: str = Field(min_length=1)
    reps: int = Field(ge=0)
    smoothedKeypoints: Any | None
    transitionCandidate: Any | None = None
    transitionStartedAtMs: float = Field(ge=0)
    invalidSinceMs: float | None = Field(default=None, ge=0)


class CaptureSummary(BaseModel):
    durationMs: float = Field(gt=0)
    frameCount: int = Field(gt=0)
    validFrames: int = Field(ge=0)
    invalidFrames: int = Field(ge=0)
    validJointRate: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def frame_counts_must_match(self) -> "CaptureSummary":
        if self.validFrames + self.invalidFrames != self.frameCount:
            raise ValueError("validFrames + invalidFrames must equal frameCount")
        return self


class DerivedSource(BaseModel):
    path: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    sourceSchemaVersion: str = Field(min_length=1)
    transform: str = Field(min_length=1)
    transformVersion: str = Field(min_length=1)
    selectionUsesExpectedOrPredictedReps: bool

    model_config = ConfigDict(extra="allow")


class CanonicalFixtureMetadata(BaseModel):
    schemaVersion: Literal["1.1-derived"]
    testId: str = Field(min_length=1)
    condition: str = Field(min_length=1)
    exercise: str = Field(min_length=1)
    role: str = Field(min_length=1)
    groundTruth: GroundTruth
    algorithmVersion: AlgorithmVersion
    configAtCapture: dict[str, Any]
    initialAlgorithmState: InitialAlgorithmState
    analysisActiveAtCapture: bool
    capture: CaptureSummary
    derivedFrom: DerivedSource
    notes: str = ""

    model_config = ConfigDict(extra="allow")


class FrameValidationResult(BaseModel):
    frameCount: int
    validFrames: int
    invalidFrames: int
    firstTimestampMs: float
    lastTimestampMs: float
    requiredKeypointNamesPresent: bool


class FixtureValidationReport(BaseModel):
    fixture: str
    testId: str
    schemaVersion: str
    metadataValid: bool
    frameValidation: FrameValidationResult
    warnings: list[str] = []


CycleLabel = Literal[
    "valid_rep",
    "partial_rep",
    "preparation",
    "repositioning",
    "tracking_failure",
    "ambiguous",
]


class CycleAnnotation(BaseModel):
    startMs: float = Field(ge=0)
    endMs: float = Field(gt=0)
    completionMs: float | None = Field(default=None, ge=0)
    label: CycleLabel
    annotator: str = Field(min_length=1)
    note: str = ""

    @model_validator(mode="after")
    def interval_and_completion_must_be_consistent(self) -> "CycleAnnotation":
        if self.endMs <= self.startMs:
            raise ValueError("annotation endMs must be greater than startMs")
        if self.completionMs is not None and not (
            self.startMs <= self.completionMs <= self.endMs
        ):
            raise ValueError("completionMs must be inside the annotation interval")
        if self.label == "valid_rep" and self.completionMs is None:
            raise ValueError("valid_rep requires completionMs")
        return self


class AnnotationDocument(BaseModel):
    schemaVersion: Literal["1.0"]
    sessionId: str = Field(min_length=1)
    cycles: list[CycleAnnotation]

    @model_validator(mode="after")
    def intervals_must_not_overlap(self) -> "AnnotationDocument":
        ordered = sorted(self.cycles, key=lambda item: (item.startMs, item.endMs))
        for previous, current in zip(ordered, ordered[1:]):
            if current.startMs < previous.endMs:
                raise ValueError(
                    "annotation intervals overlap: "
                    f"{previous.startMs}-{previous.endMs} and "
                    f"{current.startMs}-{current.endMs}"
                )
        return self


class PredictedEvent(BaseModel):
    timestampMs: float = Field(ge=0)
    type: str = Field(min_length=1)
    rep: int | None = Field(default=None, ge=1)

    model_config = ConfigDict(extra="allow")


class PredictionDocument(BaseModel):
    sessionId: str = Field(min_length=1)
    algorithmVersion: str = Field(min_length=1)
    configurationId: str = Field(min_length=1)
    events: list[PredictedEvent]

    model_config = ConfigDict(extra="allow")


class BatchSessionEntry(BaseModel):
    sessionId: str = Field(min_length=1)
    condition: dict[str, str]
    annotations: str = Field(min_length=1)
    predictions: str = Field(min_length=1)


class BatchManifest(BaseModel):
    schemaVersion: Literal["1.0"]
    dataProvenance: str = "unspecified"
    sessions: list[BatchSessionEntry] = Field(min_length=1)
