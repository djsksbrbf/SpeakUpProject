from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ThreadCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)
    author_name: str | None = Field(default=None, max_length=100)
    is_anonymous: bool = True
    owner_token: str | None = Field(default=None, min_length=8, max_length=64)

    @model_validator(mode="after")
    def validate_author_name(self):
        if not self.is_anonymous and not self.author_name:
            raise ValueError("author_name is required when posting non-anonymously.")
        return self


class ReplyCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)
    parent_id: int | None = None
    author_name: str | None = Field(default=None, max_length=100)
    is_anonymous: bool = True
    owner_token: str | None = Field(default=None, min_length=8, max_length=64)

    @model_validator(mode="after")
    def validate_author_name(self):
        if not self.is_anonymous and not self.author_name:
            raise ValueError("author_name is required when posting non-anonymously.")
        return self


class ReplyRead(BaseModel):
    id: int
    thread_id: int
    parent_id: int | None
    body: str
    author_name: str | None
    is_anonymous: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ThreadRead(BaseModel):
    id: int
    title: str
    body: str
    author_name: str | None
    is_anonymous: bool
    created_at: datetime
    replies: list[ReplyRead] = Field(default_factory=list)

    class Config:
        from_attributes = True


class ThreadCreateResponse(ThreadRead):
    owner_token: str


class ReplyCreateResponse(ReplyRead):
    owner_token: str
