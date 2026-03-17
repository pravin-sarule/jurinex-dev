"""
Main CLI entry point for the Writ Petition Auto-Population System.

Commands:
  extract   -- Extract fields from a PDF template → schema.json
  populate  -- Populate fields from case context  → result.json
  full      -- extract + populate in one step

Usage examples:
  python -m src.main extract --template template.pdf --output schema.json
  python -m src.main populate --schema schema.json --context case_data.json --output result.json
  python -m src.main full --template template.pdf --context case_data.json --output result.json
  python -m src.main populate --schema schema.json --context case_data.json --no-llm
"""

import argparse
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional, List

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from tqdm import tqdm
    TQDM_AVAILABLE = True
except ImportError:
    TQDM_AVAILABLE = False


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging(level: str = "INFO", log_file: Optional[str] = None) -> None:
    """Configure logging to stdout (and optionally a file)."""
    handlers: List[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if log_file:
        Path(log_file).parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file))

    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=handlers,
    )


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CLI command handlers
# ---------------------------------------------------------------------------

def cmd_extract(args: argparse.Namespace) -> int:
    """Extract fields from a PDF template and save schema to JSON."""
    logger.info("=== EXTRACT COMMAND ===")
    template_path = args.template

    if not Path(template_path).exists():
        logger.error("Template file not found: %s", template_path)
        print(f"Error: template file not found: {template_path}", file=sys.stderr)
        return 1

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    use_llm = not args.no_llm and bool(api_key)

    if use_llm:
        logger.info("Using LLM field extractor (Claude %s)", "claude-sonnet-4-6")
        try:
            from .extraction.llm_field_extractor import LLMFieldExtractor
            extractor = LLMFieldExtractor(api_key=api_key)
            result = extractor.extract_from_pdf(template_path, use_llm=True)
            saver = extractor
        except Exception as exc:
            logger.warning("LLM extractor failed (%s); using pattern extractor", exc)
            use_llm = False

    if not use_llm:
        if not args.no_llm and not api_key:
            logger.warning("ANTHROPIC_API_KEY not set; using pattern extractor")
        logger.info("Using pattern field extractor")
        from .extraction.field_extractor import FieldExtractor
        extractor = FieldExtractor()
        result = extractor.extract_from_pdf(template_path)
        saver = extractor

    output_path = args.output or "schema.json"
    saver.save_schema(result, output_path)

    print(f"\n✓ Extracted {len(result.fields)} fields from: {template_path}")
    print(f"✓ Schema saved to: {output_path}")

    if result.warnings:
        for w in result.warnings:
            print(f"  ⚠ {w}")

    _print_field_summary(result.fields)
    return 0


def cmd_populate(args: argparse.Namespace) -> int:
    """Populate fields using a field schema + case context."""
    logger.info("=== POPULATE COMMAND ===")

    # Load schema
    schema_path = args.schema
    if not Path(schema_path).exists():
        logger.error("Schema file not found: %s", schema_path)
        print(f"Error: schema file not found: {schema_path}", file=sys.stderr)
        return 1

    with open(schema_path, "r", encoding="utf-8") as fh:
        schema_data = json.load(fh)

    field_schema: List[dict] = schema_data.get("fields", schema_data)
    if not isinstance(field_schema, list):
        logger.error("Invalid schema format: expected 'fields' list")
        return 1

    # Load case context
    context_path = args.context
    if not Path(context_path).exists():
        logger.error("Context file not found: %s", context_path)
        print(f"Error: context file not found: {context_path}", file=sys.stderr)
        return 1

    with open(context_path, "r", encoding="utf-8") as fh:
        case_context = json.load(fh)

    logger.info(
        "Loaded %d fields from schema, context has %d top-level keys",
        len(field_schema), len(case_context),
    )

    # Build VectorDB
    from .population.vector_db_interface import VectorDBInterface
    vdb = VectorDBInterface(case_context)

    # Choose populator
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    use_llm = not args.no_llm and bool(api_key)

    if use_llm:
        logger.info("Using LLM auto-populator (Claude)")
        from .population.llm_autopopulator import LLMAutoPopulator
        populator = LLMAutoPopulator(vdb, field_schema, anthropic_api_key=api_key)
    else:
        if not args.no_llm and not api_key:
            logger.warning("ANTHROPIC_API_KEY not set; using basic auto-populator")
        logger.info("Using basic auto-populator (no LLM)")
        from .population.complete_autopopulator import ComprehensiveAutoPopulator
        populator = ComprehensiveAutoPopulator(vdb, field_schema)

    # Run population
    logger.info("Starting 5-stage population pipeline...")
    results = populator.populate_all_fields()

    # Save results
    output_path = args.output or "result.json"
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)

    metrics = results["metrics"]
    print(f"\n✓ Population complete!")
    print(f"  Fields populated : {metrics['populated_count']}/{metrics['total_fields']} "
          f"({metrics['population_rate']:.1%})")
    dist = metrics["confidence_distribution"]
    print(f"  Confidence       : high={dist['high']}, medium={dist['medium']}, low={dist['low']}")

    empty = results["empty_fields"]
    print(f"  Empty fields     : {', '.join(empty) if empty else 'none'}")
    print(f"\n✓ Results saved to: {output_path}")

    return 0


def cmd_full(args: argparse.Namespace) -> int:
    """Run extract + populate in one step."""
    logger.info("=== FULL PIPELINE ===")

    # Extract to a temp file
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode='w') as tmp:
        schema_tmp = tmp.name

    try:
        extract_args = argparse.Namespace(
            template=args.template,
            output=schema_tmp,
            no_llm=args.no_llm,
        )
        rc = cmd_extract(extract_args)
        if rc != 0:
            return rc

        populate_args = argparse.Namespace(
            schema=schema_tmp,
            context=args.context,
            output=args.output or "result.json",
            no_llm=args.no_llm,
        )
        rc = cmd_populate(populate_args)
    finally:
        try:
            os.unlink(schema_tmp)
        except OSError:
            pass

    return rc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _print_field_summary(fields) -> None:
    """Print a compact table of extracted fields."""
    print(f"\n{'Field ID':<35} {'Type':<12} {'Required'}")
    print("-" * 60)
    for f in fields:
        fid = f.field_id if hasattr(f, "field_id") else f.get("field_id", "?")
        ftype = f.field_type if hasattr(f, "field_type") else f.get("field_type", "?")
        req = f.is_required if hasattr(f, "is_required") else f.get("is_required", True)
        print(f"{fid:<35} {ftype:<12} {'yes' if req else 'no'}")


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="autopopulator",
        description="Writ Petition Auto-Population System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m src.main extract --template petition.pdf --output schema.json
  python -m src.main populate --schema schema.json --context case.json
  python -m src.main full --template petition.pdf --context case.json --output result.json
  python -m src.main populate --schema schema.json --context case.json --no-llm
        """,
    )
    parser.add_argument(
        "--log-level", default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity (default: INFO)",
    )
    parser.add_argument("--log-file", default=None, help="Optional log file path")

    sub = parser.add_subparsers(dest="command", required=True)

    # extract
    p_extract = sub.add_parser("extract", help="Extract fields from a PDF template")
    p_extract.add_argument("--template", required=True, help="Path to PDF template file")
    p_extract.add_argument("--output", default="schema.json", help="Output schema JSON path")
    p_extract.add_argument("--no-llm", action="store_true", help="Skip LLM, use patterns only")

    # populate
    p_populate = sub.add_parser("populate", help="Auto-populate fields from case context")
    p_populate.add_argument("--schema", required=True, help="Field schema JSON path")
    p_populate.add_argument("--context", required=True, help="Case context JSON path")
    p_populate.add_argument("--output", default="result.json", help="Output result JSON path")
    p_populate.add_argument("--no-llm", action="store_true", help="Skip LLM synthesis")

    # full
    p_full = sub.add_parser("full", help="Extract template fields + populate in one step")
    p_full.add_argument("--template", required=True, help="Path to PDF template file")
    p_full.add_argument("--context", required=True, help="Case context JSON path")
    p_full.add_argument("--output", default="result.json", help="Output result JSON path")
    p_full.add_argument("--no-llm", action="store_true", help="Skip LLM")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    setup_logging(args.log_level, getattr(args, "log_file", None))

    commands = {
        "extract": cmd_extract,
        "populate": cmd_populate,
        "full": cmd_full,
    }
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
