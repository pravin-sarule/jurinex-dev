"""
Category-wise template field definitions. Single source of truth for form fields
per template. Used when template_fields table is empty or template not seeded.

Fields are shown only for the opened template: resolved by template_name (or alias)
then by category default. Schema aligns with template_fields table.
"""

from typing import Any, Dict, List, Optional

# --- Helpers ---

def _f(
    name: str,
    label: str,
    field_type: str = "text",
    required: bool = True,
    order: int = 1,
    field_group: Optional[str] = None,
) -> Dict[str, Any]:
    """Build one field dict: field_name, field_label, field_type, is_required, sort_order, optional field_group."""
    out = {
        "field_name": name,
        "field_label": label,
        "field_type": field_type,
        "is_required": required,
        "sort_order": order,
    }
    if field_group is not None:
        out["field_group"] = field_group
    return out


def normalize_category(category: str) -> str:
    """Normalize category for lookup: strip, upper, spaces -> underscores."""
    if not category:
        return ""
    return category.strip().upper().replace(" ", "_")


# --- 1. REAL ESTATE ---

RENT_AGREEMENT = [
    _f("landlord_name", "Landlord Name", order=1, field_group="Parties"),
    _f("tenant_name", "Tenant Name", order=2, field_group="Parties"),
    _f("property_address", "Property Address", "textarea", order=3, field_group="Property & financials"),
    _f("monthly_rent", "Monthly Rent", "number", order=4, field_group="Property & financials"),
    _f("security_deposit", "Security Deposit", "number", order=5, field_group="Property & financials"),
    _f("lease_start_date", "Lease Start Date", "date", order=6, field_group="Dates"),
    _f("lease_end_date", "Lease End Date", "date", order=7, field_group="Dates"),
    _f("payment_due_day", "Rent Due Day", "number", order=8, field_group="Dates"),
    _f("maintenance_charges", "Maintenance Charges", "number", False, 9, "Other terms"),
    _f("lock_in_period", "Lock-in Period (months)", required=False, order=10, field_group="Other terms"),
    _f("notice_period", "Notice Period (days)", required=False, order=11, field_group="Other terms"),
]

SALE_DEED = [
    _f("seller_name", "Seller Name", order=1, field_group="Parties"),
    _f("buyer_name", "Buyer Name", order=2, field_group="Parties"),
    _f("property_address", "Property Address", "textarea", order=3, field_group="Property"),
    _f("sale_amount", "Sale Amount", "number", order=4, field_group="Property"),
    _f("advance_paid", "Advance Paid", "number", order=5, field_group="Property"),
    _f("balance_amount", "Balance Amount", "number", order=6, field_group="Property"),
    _f("registration_date", "Registration Date", "date", order=7, field_group="Dates"),
    _f("possession_date", "Possession Date", "date", order=8, field_group="Dates"),
]

LEASE_DEED = [
    _f("lessor_name", "Lessor Name", order=1, field_group="Parties"),
    _f("lessee_name", "Lessee Name", order=2, field_group="Parties"),
    _f("property_address", "Property Address", "textarea", order=3, field_group="Property"),
    _f("lease_period", "Lease Period", order=4, field_group="Term"),
    _f("rent_amount", "Rent Amount", "number", order=5, field_group="Financials"),
    _f("security_deposit", "Security Deposit", "number", order=6, field_group="Financials"),
]

# --- 2. CORPORATE & BUSINESS ---

NDA = [
    _f("disclosing_party", "Disclosing Party", order=1, field_group="Parties"),
    _f("receiving_party", "Receiving Party", order=2, field_group="Parties"),
    _f("confidential_info_definition", "Confidential Info Definition", "textarea", order=3, field_group="Scope"),
    _f("purpose", "Purpose", order=4, field_group="Scope"),
    _f("agreement_start", "Agreement Start", "date", order=5, field_group="Term"),
    _f("agreement_end", "Agreement End", "date", order=6, field_group="Term"),
    _f("jurisdiction", "Jurisdiction", order=7, field_group="Term"),
]

MOU = [
    _f("party_one", "Party One", order=1, field_group="Parties"),
    _f("party_two", "Party Two", order=2, field_group="Parties"),
    _f("business_purpose", "Business Purpose", "textarea", order=3, field_group="Purpose & terms"),
    _f("roles_responsibilities", "Roles & Responsibilities", "textarea", order=4, field_group="Purpose & terms"),
    _f("profit_sharing", "Profit Sharing", order=5, field_group="Purpose & terms"),
    _f("term", "Term", order=6, field_group="Purpose & terms"),
    _f("governing_law", "Governing Law", order=7, field_group="Purpose & terms"),
]

PARTNERSHIP_DEED = [
    _f("firm_name", "Firm Name", order=1, field_group="Parties"),
    _f("partner_names", "Partner Names", "textarea", order=2, field_group="Parties"),
    _f("capital_contribution", "Capital Contribution", order=3, field_group="Business & financials"),
    _f("profit_ratio", "Profit Ratio", order=4, field_group="Business & financials"),
    _f("business_activity", "Business Activity", "textarea", order=5, field_group="Business & financials"),
    _f("start_date", "Start Date", "date", order=6, field_group="Dates"),
]

# --- 3. LITIGATION ---

CIVIL_PETITION = [
    _f("court_name", "Court Name", order=1, field_group="Court & parties"),
    _f("petitioner_name", "Petitioner Name", order=2, field_group="Court & parties"),
    _f("respondent_name", "Respondent Name", order=3, field_group="Court & parties"),
    _f("petitioner_address", "Petitioner Address", "textarea", order=4, field_group="Court & parties"),
    _f("respondent_address", "Respondent Address", "textarea", order=5, field_group="Court & parties"),
    _f("case_subject", "Case Subject", order=6, field_group="Case details"),
    _f("facts", "Facts", "textarea", order=7, field_group="Case details"),
    _f("relief_sought", "Relief Sought", "textarea", order=8, field_group="Case details"),
    _f("date", "Date", "date", order=9, field_group="Case details"),
]

AFFIDAVIT = [
    _f("deponent_name", "Deponent Name", order=1, field_group="Deponent"),
    _f("father_or_spouse_name", "Father / Spouse Name", order=2, field_group="Deponent"),
    _f("address", "Address", "textarea", order=3, field_group="Deponent"),
    _f("statement_of_truth", "Statement of Truth", "textarea", order=4, field_group="Statement"),
    _f("date", "Date", "date", order=5, field_group="Statement"),
    _f("place", "Place", order=6, field_group="Statement"),
]

VAKALATNAMA = [
    _f("client_name", "Client Name", order=1, field_group="Parties"),
    _f("advocate_name", "Advocate Name", order=2, field_group="Parties"),
    _f("case_details", "Case Details", "textarea", order=3, field_group="Case details"),
    _f("court_name", "Court Name", order=4, field_group="Case details"),
]

# --- 4. FAMILY LAW ---

DIVORCE_PETITION = [
    _f("husband_name", "Husband Name", order=1, field_group="Parties"),
    _f("wife_name", "Wife Name", order=2, field_group="Parties"),
    _f("marriage_date", "Marriage Date", "date", order=3, field_group="Marriage details"),
    _f("marriage_place", "Marriage Place", order=4, field_group="Marriage details"),
    _f("reason_for_divorce", "Reason for Divorce", "textarea", order=5, field_group="Grounds & relief"),
    _f("children_details", "Children Details", "textarea", order=6, field_group="Grounds & relief"),
    _f("maintenance_claim", "Maintenance Claim", "textarea", False, 7, "Grounds & relief"),
]

CHILD_CUSTODY = [
    _f("parent_name", "Parent Name", order=1, field_group="Parties"),
    _f("child_name", "Child Name", order=2, field_group="Parties"),
    _f("child_age", "Child Age", "number", order=3, field_group="Child details"),
    _f("custody_type", "Custody Type", order=4, field_group="Child details"),
    _f("reason", "Reason", "textarea", order=5, field_group="Child details"),
]

# --- 5. CRIMINAL LAW ---

BAIL_APPLICATION = [
    _f("accused_name", "Accused Name", order=1, field_group="Accused"),
    _f("father_name", "Father Name", order=2, field_group="Accused"),
    _f("crime_number", "Crime Number", order=3, field_group="Case details"),
    _f("police_station", "Police Station", order=4, field_group="Case details"),
    _f("court_name", "Court Name", order=5, field_group="Case details"),
    _f("offence", "Offence", order=6, field_group="Case details"),
    _f("grounds_for_bail", "Grounds for Bail", "textarea", order=7, field_group="Case details"),
]

FIR_DRAFT = [
    _f("complainant_name", "Complainant Name", order=1, field_group="Parties"),
    _f("accused_name", "Accused Name", order=2, field_group="Parties"),
    _f("incident_date", "Incident Date", "date", order=3, field_group="Incident"),
    _f("incident_place", "Incident Place", order=4, field_group="Incident"),
    _f("incident_details", "Incident Details", "textarea", order=5, field_group="Incident"),
]

# --- 6. EMPLOYMENT & HR ---

EMPLOYMENT_CONTRACT = [
    _f("employee_name", "Employee Name", order=1, field_group="Parties"),
    _f("employer_name", "Employer Name", order=2, field_group="Parties"),
    _f("designation", "Designation", order=3, field_group="Employment terms"),
    _f("salary", "Salary", "number", order=4, field_group="Employment terms"),
    _f("joining_date", "Joining Date", "date", order=5, field_group="Employment terms"),
    _f("work_location", "Work Location", order=6, field_group="Employment terms"),
    _f("probation_period", "Probation Period", required=False, order=7, field_group="Employment terms"),
]

TERMINATION_LETTER = [
    _f("employee_name", "Employee Name", order=1, field_group="Parties"),
    _f("termination_date", "Termination Date", "date", order=2, field_group="Termination details"),
    _f("reason", "Reason", "textarea", order=3, field_group="Termination details"),
    _f("notice_period", "Notice Period", required=False, order=4, field_group="Termination details"),
]

# --- 7. INTELLECTUAL PROPERTY ---

TRADEMARK_APPLICATION = [
    _f("applicant_name", "Applicant Name", order=1, field_group="Applicant"),
    _f("brand_name", "Brand Name", order=2, field_group="Applicant"),
    _f("business_type", "Business Type", order=3, field_group="Mark details"),
    _f("logo_description", "Logo Description", "textarea", order=4, field_group="Mark details"),
    _f("class", "Class", order=5, field_group="Mark details"),
]

COPYRIGHT = [
    _f("author_name", "Author Name", order=1, field_group="Author"),
    _f("work_title", "Work Title", order=2, field_group="Work details"),
    _f("work_type", "Work Type", order=3, field_group="Work details"),
    _f("creation_date", "Creation Date", "date", order=4, field_group="Work details"),
]

# --- 8. GENERAL LEGAL ---

POWER_OF_ATTORNEY = [
    _f("principal_name", "Principal Name", order=1, field_group="Parties"),
    _f("agent_name", "Agent Name", order=2, field_group="Parties"),
    _f("powers_granted", "Powers Granted", "textarea", order=3, field_group="Powers & scope"),
    _f("property_details", "Property Details", "textarea", False, 4, "Powers & scope"),
    _f("validity", "Validity", order=5, field_group="Powers & scope"),
]

INDEMNITY_BOND = [
    _f("indemnifier_name", "Indemnifier Name", order=1, field_group="Parties"),
    _f("beneficiary_name", "Beneficiary Name", order=2, field_group="Parties"),
    _f("amount", "Amount", "number", order=3, field_group="Terms"),
    _f("purpose", "Purpose", "textarea", order=4, field_group="Terms"),
]

# --- Single source: template_name -> fields (only this template's fields shown when opened) ---

TEMPLATE_FIELDS: Dict[str, List[Dict[str, Any]]] = {
    # 1. REAL ESTATE
    "Rent Agreement": RENT_AGREEMENT,
    "Sale Deed": SALE_DEED,
    "Lease Deed": LEASE_DEED,
    # 2. CORPORATE & BUSINESS
    "NDA": NDA,
    "MoU": MOU,
    "Partnership Deed": PARTNERSHIP_DEED,
    # 3. LITIGATION
    "Civil Petition": CIVIL_PETITION,
    "Affidavit": AFFIDAVIT,
    "Vakalatnama": VAKALATNAMA,
    # 4. FAMILY LAW
    "Divorce Petition": DIVORCE_PETITION,
    "Child Custody": CHILD_CUSTODY,
    # 5. CRIMINAL LAW
    "Bail Application": BAIL_APPLICATION,
    "FIR Draft": FIR_DRAFT,
    # 6. EMPLOYMENT & HR
    "Employment Contract": EMPLOYMENT_CONTRACT,
    "Termination Letter": TERMINATION_LETTER,
    # 7. INTELLECTUAL PROPERTY
    "Trademark Application": TRADEMARK_APPLICATION,
    "Copyright": COPYRIGHT,
    # 8. GENERAL LEGAL
    "Power of Attorney": POWER_OF_ATTORNEY,
    "Indemnity Bond": INDEMNITY_BOND,
}

# DB template_name -> canonical key in TEMPLATE_FIELDS (so all templates resolve category-wise)
TEMPLATE_NAME_ALIASES: Dict[str, str] = {
    # REAL ESTATE
    "final": "Rent Agreement",
    "rent agreement": "Rent Agreement",
    "sale deed": "Sale Deed",
    "lease deed": "Lease Deed",
    # CORPORATE & BUSINESS
    "Non Disclosure Agreement": "NDA",
    "nda": "NDA",
    "Memorandum of Understanding": "MoU",
    "mou": "MoU",
    "partnership deed": "Partnership Deed",
    # LITIGATION
    "petition": "Civil Petition",
    "test pet": "Civil Petition",
    "civil petition": "Civil Petition",
    "affidavit": "Affidavit",
    "vakalatnama": "Vakalatnama",
    # FAMILY LAW
    "divorce petition": "Divorce Petition",
    "child custody": "Child Custody",
    # CRIMINAL LAW
    "bail application": "Bail Application",
    "FIR": "FIR Draft",
    "fir": "FIR Draft",
    # EMPLOYMENT & HR
    "employment contract": "Employment Contract",
    "termination letter": "Termination Letter",
    # INTELLECTUAL PROPERTY
    "trademark": "Trademark Application",
    "copyright": "Copyright",
    # GENERAL LEGAL
    "power of attorney": "Power of Attorney",
    "indemnity bond": "Indemnity Bond",
}

# Normalized category -> default template name when template_name not in TEMPLATE_FIELDS
CATEGORY_DEFAULT_TEMPLATE: Dict[str, str] = {
    "REAL_ESTATE": "Rent Agreement",
    "CORPORATE_&_BUSINESS": "NDA",
    "CORPORATE": "NDA",
    "LITIGATION": "Civil Petition",
    "FAMILY_LAW": "Divorce Petition",
    "CRIMINAL_LAW": "Bail Application",
    "EMPLOYMENT_&_HR": "Employment Contract",
    "EMPLOYMENT": "Employment Contract",
    "INTELLECTUAL_PROPERTY": "Trademark Application",
    "GENERAL_LEGAL": "Power of Attorney",
}
