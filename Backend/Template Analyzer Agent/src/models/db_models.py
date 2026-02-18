from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func
import uuid
from ..database import Base

class UserTemplate(Base):
    """
    Stores user-specific template metadata.
    Maps to table 'user_templates'.
    """
    __tablename__ = "user_templates"

    template_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=True)
    sub_category = Column(String(100), nullable=True) # Note: SQL says sub_category
    language = Column(String(50), default='en')
    status = Column(String(50), default='active')
    description = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True) # Admin/System UUID if applicable
    user_id = Column(Integer, nullable=False, index=True) # The user who owns this template
    image_url = Column(Text, nullable=True)
    file_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class UserTemplateField(Base):
    """
    Stores extracted fields for a user template.
    Maps to table 'user_template_fields'.
    """
    __tablename__ = "user_template_fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey('user_templates.template_id', ondelete="CASCADE"), nullable=False, index=True)
    template_fields = Column(JSONB, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class UserTemplateAnalysisSection(Base):
    """
    Stores logical sections for a user template.
    Maps to table 'user_template_analysis_sections'.
    """
    __tablename__ = "user_template_analysis_sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey('user_templates.template_id', ondelete="CASCADE"), nullable=False, index=True)
    section_name = Column(String(255), nullable=False)
    section_purpose = Column(Text, nullable=True)
    section_intro = Column(Text, nullable=True)
    section_prompts = Column(JSONB, nullable=False)
    order_index = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
