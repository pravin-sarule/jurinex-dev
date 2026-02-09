-- Seed template_fields for each template. Run after templates exist.
-- Matches templates by template_name. Creates form fields so the draft form shows template-wise fields.

-- Helper: insert fields for a template by name. field_type: text, number, date, textarea.
-- Uses ON CONFLICT DO NOTHING so re-run is safe (unique on template_id, field_name).

-- 1. Rent Agreement (REAL ESTATE)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('landlord_name', 'Landlord Name', 'text', true, 1),
  ('tenant_name', 'Tenant Name', 'text', true, 2),
  ('property_address', 'Property Address', 'textarea', true, 3),
  ('monthly_rent', 'Monthly Rent', 'number', true, 4),
  ('security_deposit', 'Security Deposit', 'number', true, 5),
  ('lease_start_date', 'Lease Start Date', 'date', true, 6),
  ('lease_end_date', 'Lease End Date', 'date', true, 7),
  ('payment_due_day', 'Payment Due Day', 'number', true, 8),
  ('maintenance_charges', 'Maintenance Charges', 'number', false, 9),
  ('lock_in_period', 'Lock-in Period', 'text', false, 10),
  ('notice_period', 'Notice Period', 'text', false, 11)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Rent Agreement'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 2. Sale Deed
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('seller_name', 'Seller Name', 'text', true, 1),
  ('buyer_name', 'Buyer Name', 'text', true, 2),
  ('property_address', 'Property Address', 'textarea', true, 3),
  ('sale_amount', 'Sale Amount', 'number', true, 4),
  ('advance_paid', 'Advance Paid', 'number', true, 5),
  ('balance_amount', 'Balance Amount', 'number', true, 6),
  ('registration_date', 'Registration Date', 'date', true, 7),
  ('possession_date', 'Possession Date', 'date', true, 8)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Sale Deed'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 3. Lease Deed
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('lessor_name', 'Lessor Name', 'text', true, 1),
  ('lessee_name', 'Lessee Name', 'text', true, 2),
  ('property_address', 'Property Address', 'textarea', true, 3),
  ('lease_period', 'Lease Period', 'text', true, 4),
  ('rent_amount', 'Rent Amount', 'number', true, 5),
  ('security_deposit', 'Security Deposit', 'number', true, 6)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Lease Deed'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 4. NDA (CORPORATE & BUSINESS)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('disclosing_party', 'Disclosing Party', 'text', true, 1),
  ('receiving_party', 'Receiving Party', 'text', true, 2),
  ('confidential_info_definition', 'Confidential Info Definition', 'textarea', true, 3),
  ('purpose', 'Purpose', 'text', true, 4),
  ('agreement_start', 'Agreement Start', 'date', true, 5),
  ('agreement_end', 'Agreement End', 'date', true, 6),
  ('jurisdiction', 'Jurisdiction', 'text', true, 7)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'NDA'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 5. MoU
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('party_one', 'Party One', 'text', true, 1),
  ('party_two', 'Party Two', 'text', true, 2),
  ('business_purpose', 'Business Purpose', 'textarea', true, 3),
  ('roles_responsibilities', 'Roles & Responsibilities', 'textarea', true, 4),
  ('profit_sharing', 'Profit Sharing', 'text', true, 5),
  ('term', 'Term', 'text', true, 6),
  ('governing_law', 'Governing Law', 'text', true, 7)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'MoU'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 6. Partnership Deed
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('firm_name', 'Firm Name', 'text', true, 1),
  ('partner_names', 'Partner Names', 'textarea', true, 2),
  ('capital_contribution', 'Capital Contribution', 'text', true, 3),
  ('profit_ratio', 'Profit Ratio', 'text', true, 4),
  ('business_activity', 'Business Activity', 'textarea', true, 5),
  ('start_date', 'Start Date', 'date', true, 6)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Partnership Deed'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 7. Civil Petition (LITIGATION)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('court_name', 'Court Name', 'text', true, 1),
  ('petitioner_name', 'Petitioner Name', 'text', true, 2),
  ('respondent_name', 'Respondent Name', 'text', true, 3),
  ('petitioner_address', 'Petitioner Address', 'textarea', true, 4),
  ('respondent_address', 'Respondent Address', 'textarea', true, 5),
  ('case_subject', 'Case Subject', 'text', true, 6),
  ('facts', 'Facts', 'textarea', true, 7),
  ('relief_sought', 'Relief Sought', 'textarea', true, 8),
  ('date', 'Date', 'date', true, 9)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Civil Petition'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 8. Affidavit
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('deponent_name', 'Deponent Name', 'text', true, 1),
  ('father_or_spouse_name', 'Father / Spouse Name', 'text', true, 2),
  ('address', 'Address', 'textarea', true, 3),
  ('statement_of_truth', 'Statement of Truth', 'textarea', true, 4),
  ('date', 'Date', 'date', true, 5),
  ('place', 'Place', 'text', true, 6)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Affidavit'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 9. Vakalatnama
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('client_name', 'Client Name', 'text', true, 1),
  ('advocate_name', 'Advocate Name', 'text', true, 2),
  ('case_details', 'Case Details', 'textarea', true, 3),
  ('court_name', 'Court Name', 'text', true, 4)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Vakalatnama'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 10. Divorce Petition (FAMILY LAW)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('husband_name', 'Husband Name', 'text', true, 1),
  ('wife_name', 'Wife Name', 'text', true, 2),
  ('marriage_date', 'Marriage Date', 'date', true, 3),
  ('marriage_place', 'Marriage Place', 'text', true, 4),
  ('reason_for_divorce', 'Reason for Divorce', 'textarea', true, 5),
  ('children_details', 'Children Details', 'textarea', true, 6),
  ('maintenance_claim', 'Maintenance Claim', 'textarea', false, 7)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Divorce Petition'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 11. Child Custody
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('parent_name', 'Parent Name', 'text', true, 1),
  ('child_name', 'Child Name', 'text', true, 2),
  ('child_age', 'Child Age', 'number', true, 3),
  ('custody_type', 'Custody Type', 'text', true, 4),
  ('reason', 'Reason', 'textarea', true, 5)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Child Custody'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 12. Bail Application (CRIMINAL LAW)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('accused_name', 'Accused Name', 'text', true, 1),
  ('father_name', 'Father Name', 'text', true, 2),
  ('crime_number', 'Crime Number', 'text', true, 3),
  ('police_station', 'Police Station', 'text', true, 4),
  ('court_name', 'Court Name', 'text', true, 5),
  ('offence', 'Offence', 'text', true, 6),
  ('grounds_for_bail', 'Grounds for Bail', 'textarea', true, 7)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Bail Application'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 13. FIR Draft
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('complainant_name', 'Complainant Name', 'text', true, 1),
  ('accused_name', 'Accused Name', 'text', true, 2),
  ('incident_date', 'Incident Date', 'date', true, 3),
  ('incident_place', 'Incident Place', 'text', true, 4),
  ('incident_details', 'Incident Details', 'textarea', true, 5)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'FIR Draft'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 14. Employment Contract (EMPLOYMENT & HR)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('employee_name', 'Employee Name', 'text', true, 1),
  ('employer_name', 'Employer Name', 'text', true, 2),
  ('designation', 'Designation', 'text', true, 3),
  ('salary', 'Salary', 'number', true, 4),
  ('joining_date', 'Joining Date', 'date', true, 5),
  ('work_location', 'Work Location', 'text', true, 6),
  ('probation_period', 'Probation Period', 'text', false, 7)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Employment Contract'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 15. Termination Letter
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('employee_name', 'Employee Name', 'text', true, 1),
  ('termination_date', 'Termination Date', 'date', true, 2),
  ('reason', 'Reason', 'textarea', true, 3),
  ('notice_period', 'Notice Period', 'text', false, 4)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Termination Letter'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 16. Trademark Application (INTELLECTUAL PROPERTY)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('applicant_name', 'Applicant Name', 'text', true, 1),
  ('brand_name', 'Brand Name', 'text', true, 2),
  ('business_type', 'Business Type', 'text', true, 3),
  ('logo_description', 'Logo Description', 'textarea', true, 4),
  ('class', 'Class', 'text', true, 5)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Trademark Application'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 17. Copyright
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('author_name', 'Author Name', 'text', true, 1),
  ('work_title', 'Work Title', 'text', true, 2),
  ('work_type', 'Work Type', 'text', true, 3),
  ('creation_date', 'Creation Date', 'date', true, 4)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Copyright'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 18. Power of Attorney (GENERAL LEGAL)
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('principal_name', 'Principal Name', 'text', true, 1),
  ('agent_name', 'Agent Name', 'text', true, 2),
  ('powers_granted', 'Powers Granted', 'textarea', true, 3),
  ('property_details', 'Property Details', 'textarea', false, 4),
  ('validity', 'Validity', 'text', true, 5)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Power of Attorney'
ON CONFLICT (template_id, field_name) DO NOTHING;

-- 19. Indemnity Bond
INSERT INTO template_fields (template_id, field_name, field_label, field_type, is_required, sort_order)
SELECT t.template_id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order
FROM templates t,
LATERAL (VALUES
  ('indemnifier_name', 'Indemnifier Name', 'text', true, 1),
  ('beneficiary_name', 'Beneficiary Name', 'text', true, 2),
  ('amount', 'Amount', 'number', true, 3),
  ('purpose', 'Purpose', 'textarea', true, 4)
) AS f(field_name, field_label, field_type, is_required, sort_order)
WHERE t.template_name = 'Indemnity Bond'
ON CONFLICT (template_id, field_name) DO NOTHING;
