import React, { useState } from 'react';
import { Eye, EyeOff, ArrowLeft, Check, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ApiService from '../../services/api';
import Swal from 'sweetalert2';
import JuriNexLogo from '../../assets/JuriNex_gavel_logo.png';
import './LawFirmRegistrationPage.css';

const LawFirmRegistrationPage = () => {
  const navigate = useNavigate();
  const [registrationType, setRegistrationType] = useState('SOLO'); // 'SOLO' or 'FIRM'
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Solo Lawyer Form Data
  const [soloData, setSoloData] = useState({
    full_name: '',
    bar_enrollment_number: '',
    enrollment_date: '',
    state_bar_council: '',
    email: '',
    mobile: '',
    office_address: '',
    city: '',
    state: '',
    pin_code: '',
    pan_number: '',
    gst_number: '',
    password: '',
    confirmPassword: ''
  });

  // Firm Form Data
  const [firmData, setFirmData] = useState({
    firm_name: '',
    registering_advocate_name: '',
    bar_enrollment_number: '',
    enrollment_date: '',
    state_bar_council: '',
    firm_type: '',
    establishment_date: '',
    email: '',
    mobile: '',
    landline: '',
    office_address: '',
    city: '',
    district: '',
    state: '',
    pin_code: '',
    pan_number: '',
    gst_number: ''
  });

  const [errors, setErrors] = useState({});

  // Solo Lawyer Steps (without Practice)
  const soloSteps = [
    { number: 1, label: 'Personal' },
    { number: 2, label: 'Contact' },
    { number: 3, label: 'Address' },
    { number: 4, label: 'Tax Details' },
    { number: 5, label: 'Review' }
  ];

  // Firm Steps (with Practice)
  const firmSteps = [
    { number: 1, label: 'Personal' },
    { number: 2, label: 'Practice' },
    { number: 3, label: 'Contact' },
    { number: 4, label: 'Address' },
    { number: 5, label: 'Tax Details' },
    { number: 6, label: 'Review' }
  ];

  const steps = registrationType === 'SOLO' ? soloSteps : firmSteps;
  const totalSteps = registrationType === 'SOLO' ? 5 : 6;

  const validateSoloStep = (step) => {
    const newErrors = {};
    
    if (step === 1) {
      if (!soloData.full_name.trim()) newErrors.full_name = 'Full name is required';
      if (!soloData.bar_enrollment_number.trim()) newErrors.bar_enrollment_number = 'Bar enrollment number is required';
      if (!soloData.state_bar_council.trim()) newErrors.state_bar_council = 'State bar council is required';
    } else if (step === 2) {
      if (!soloData.email.trim()) newErrors.email = 'Email is required';
      else if (!/\S+@\S+\.\S+/.test(soloData.email)) newErrors.email = 'Email is invalid';
      if (!soloData.mobile.trim()) newErrors.mobile = 'Mobile number is required';
      else if (!/^[0-9]{10}$/.test(soloData.mobile)) newErrors.mobile = 'Mobile number must be 10 digits';
    } else if (step === 3) {
      if (!soloData.office_address.trim()) newErrors.office_address = 'Office address is required';
      if (!soloData.city.trim()) newErrors.city = 'City is required';
      if (!soloData.state.trim()) newErrors.state = 'State is required';
      if (!soloData.pin_code.trim()) newErrors.pin_code = 'Pin code is required';
      else if (!/^[0-9]{6}$/.test(soloData.pin_code)) newErrors.pin_code = 'Pin code must be 6 digits';
    } else if (step === 4) {
      if (!soloData.pan_number.trim()) newErrors.pan_number = 'PAN number is required';
      else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(soloData.pan_number)) newErrors.pan_number = 'Invalid PAN format';
      if (soloData.gst_number && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(soloData.gst_number)) {
        newErrors.gst_number = 'Invalid GST format';
      }
      if (!soloData.password) newErrors.password = 'Password is required';
      else if (soloData.password.length < 6) newErrors.password = 'Password must be at least 6 characters';
      if (!soloData.confirmPassword) newErrors.confirmPassword = 'Please confirm password';
      else if (soloData.password !== soloData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateFirmStep = (step) => {
    const newErrors = {};
    
    if (step === 1) {
      if (!firmData.firm_name.trim()) newErrors.firm_name = 'Firm name is required';
      if (!firmData.registering_advocate_name.trim()) newErrors.registering_advocate_name = 'Advocate name is required';
      // Bar Enrollment Number, Enrollment Date, and State Bar Council are now optional
    } else if (step === 2) {
      if (!firmData.firm_type.trim()) newErrors.firm_type = 'Firm type is required';
      // Establishment date is now optional
    } else if (step === 3) {
      if (!firmData.email.trim()) newErrors.email = 'Email is required';
      else if (!/\S+@\S+\.\S+/.test(firmData.email)) newErrors.email = 'Email is invalid';
      if (!firmData.mobile.trim()) newErrors.mobile = 'Mobile number is required';
      else if (!/^[0-9]{10}$/.test(firmData.mobile)) newErrors.mobile = 'Mobile number must be 10 digits';
    } else if (step === 4) {
      if (!firmData.office_address.trim()) newErrors.office_address = 'Office address is required';
      if (!firmData.city.trim()) newErrors.city = 'City is required';
      if (!firmData.state.trim()) newErrors.state = 'State is required';
      if (!firmData.pin_code.trim()) newErrors.pin_code = 'Pin code is required';
      else if (!/^[0-9]{6}$/.test(firmData.pin_code)) newErrors.pin_code = 'Pin code must be 6 digits';
    } else if (step === 5) {
      if (!firmData.pan_number.trim()) newErrors.pan_number = 'PAN number is required';
      else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(firmData.pan_number)) newErrors.pan_number = 'Invalid PAN format';
      if (firmData.gst_number && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(firmData.gst_number)) {
        newErrors.gst_number = 'Invalid GST format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    const isValid = registrationType === 'SOLO' 
      ? validateSoloStep(currentStep)
      : validateFirmStep(currentStep);
    
    const maxStep = registrationType === 'SOLO' ? 5 : 6;
    if (isValid && currentStep < maxStep) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSoloChange = (field, value) => {
    setSoloData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleFirmChange = (field, value) => {
    setFirmData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async () => {
    const maxStep = registrationType === 'SOLO' ? 4 : 5;
    const isValid = registrationType === 'SOLO'
      ? validateSoloStep(maxStep)
      : validateFirmStep(maxStep);

    if (!isValid) {
      setCurrentStep(maxStep);
      return;
    }

    setIsLoading(true);
    try {
      if (registrationType === 'SOLO') {
        const response = await ApiService.registerSoloLawyer({
          full_name: soloData.full_name,
          bar_enrollment_number: soloData.bar_enrollment_number,
          state_bar_council: soloData.state_bar_council,
          email: soloData.email,
          mobile: soloData.mobile,
          office_address: soloData.office_address,
          city: soloData.city,
          state: soloData.state,
          pin_code: soloData.pin_code,
          pan_number: soloData.pan_number,
          gst_number: soloData.gst_number || null,
          password: soloData.password
        });

        if (response.token) {
          localStorage.setItem('token', response.token);
        }

        await Swal.fire({
          icon: 'success',
          title: 'Registration Successful!',
          text: 'You have been registered successfully. Redirecting to login...',
          confirmButtonColor: '#1AA49B'
        });

        window.location.href = '/login';
      } else {
        const response = await ApiService.registerFirm({
          firm_name: firmData.firm_name,
          registering_advocate_name: firmData.registering_advocate_name,
          bar_enrollment_number: firmData.bar_enrollment_number,
          enrollment_date: firmData.enrollment_date,
          state_bar_council: firmData.state_bar_council,
          firm_type: firmData.firm_type,
          establishment_date: firmData.establishment_date,
          email: firmData.email,
          mobile: firmData.mobile,
          landline: firmData.landline || null,
          office_address: firmData.office_address,
          city: firmData.city,
          district: firmData.district || null,
          state: firmData.state,
          pin_code: firmData.pin_code,
          pan_number: firmData.pan_number,
          gst_number: firmData.gst_number || null
        });

        await Swal.fire({
          icon: 'info',
          title: 'Application Submitted!',
          html: `
            <p style="text-align: left; margin: 10px 0;">
              Your firm registration application has been submitted successfully.
            </p>
            <p style="text-align: left; margin: 10px 0;">
              <strong>Status:</strong> Under Review
            </p>
            <p style="text-align: left; margin: 10px 0;">
              Your application is currently under review. You will receive access within 24 hours after verification.
            </p>
            <p style="text-align: left; margin: 10px 0; color: #666;">
              You will receive an email with your admin credentials once your application is approved.
            </p>
          `,
          confirmButtonColor: '#1AA49B',
          width: '500px'
        });

        window.location.href = '/login';
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Registration failed. Please try again.';
      await Swal.fire({
        icon: 'error',
        title: 'Registration Failed',
        text: errorMessage,
        confirmButtonColor: '#1AA49B'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Not provided';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const renderSoloStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="section">
            <div className="section-title">Personal Information</div>
            <p className="section-description">Enter your basic details as per Bar Council records</p>
            <div className="form-row">
              <div className="form-group">
                <label>Full Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.full_name}
                  onChange={(e) => handleSoloChange('full_name', e.target.value)}
                  placeholder="As per Bar Council enrollment"
                  className={errors.full_name ? 'error' : ''}
                />
                {errors.full_name && <span className="error-message">{errors.full_name}</span>}
              </div>
              <div className="form-group">
                <label>Bar Enrollment Number <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.bar_enrollment_number}
                  onChange={(e) => handleSoloChange('bar_enrollment_number', e.target.value)}
                  placeholder="e.g., D/1234/2020"
                  className={errors.bar_enrollment_number ? 'error' : ''}
                />
                {errors.bar_enrollment_number && <span className="error-message">{errors.bar_enrollment_number}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Enrollment Date <span className="required">*</span></label>
                <input
                  type="date"
                  value={soloData.enrollment_date}
                  onChange={(e) => handleSoloChange('enrollment_date', e.target.value)}
                  className={errors.enrollment_date ? 'error' : ''}
                />
                {errors.enrollment_date && <span className="error-message">{errors.enrollment_date}</span>}
              </div>
              <div className="form-group">
                <label>State Bar Council <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.state_bar_council}
                  onChange={(e) => handleSoloChange('state_bar_council', e.target.value)}
                  placeholder="e.g., Gujarat State Bar Council"
                  className={errors.state_bar_council ? 'error' : ''}
                />
                {errors.state_bar_council && <span className="error-message">{errors.state_bar_council}</span>}
              </div>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="section">
            <div className="section-title">Contact Information</div>
            <p className="section-description">Enter your contact details</p>
            <div className="form-row">
              <div className="form-group">
                <label>Email Address <span className="required">*</span></label>
                <input
                  type="email"
                  value={soloData.email}
                  onChange={(e) => handleSoloChange('email', e.target.value)}
                  placeholder="your.email@example.com"
                  className={errors.email ? 'error' : ''}
                />
                <span className="help-text">All communications will be sent to this email</span>
                {errors.email && <span className="error-message">{errors.email}</span>}
              </div>
              <div className="form-group">
                <label>Mobile Number <span className="required">*</span></label>
                <input
                  type="tel"
                  value={soloData.mobile}
                  onChange={(e) => handleSoloChange('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  maxLength="10"
                  className={errors.mobile ? 'error' : ''}
                />
                <span className="help-text">Format: 9876543210</span>
                {errors.mobile && <span className="error-message">{errors.mobile}</span>}
              </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="section">
            <div className="section-title">Office Address</div>
            <p className="section-description">Enter your office address details</p>
            <div className="form-row full">
              <div className="form-group">
                <label>Office Address <span className="required">*</span></label>
                <textarea
                  value={soloData.office_address}
                  onChange={(e) => handleSoloChange('office_address', e.target.value)}
                  rows="3"
                  placeholder="Building name, street, locality"
                  className={errors.office_address ? 'error' : ''}
                />
                {errors.office_address && <span className="error-message">{errors.office_address}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>City <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.city}
                  onChange={(e) => handleSoloChange('city', e.target.value)}
                  className={errors.city ? 'error' : ''}
                />
                {errors.city && <span className="error-message">{errors.city}</span>}
              </div>
              <div className="form-group">
                <label>State <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.state}
                  onChange={(e) => handleSoloChange('state', e.target.value)}
                  className={errors.state ? 'error' : ''}
                />
                {errors.state && <span className="error-message">{errors.state}</span>}
              </div>
              <div className="form-group">
                <label>PIN Code <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.pin_code}
                  onChange={(e) => handleSoloChange('pin_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit PIN"
                  maxLength="6"
                  className={errors.pin_code ? 'error' : ''}
                />
                {errors.pin_code && <span className="error-message">{errors.pin_code}</span>}
              </div>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="section">
            <div className="section-title">Tax & Registration Details</div>
            <p className="section-description">Enter your tax and registration information</p>
            <div className="form-row">
              <div className="form-group">
                <label>PAN Number <span className="required">*</span></label>
                <input
                  type="text"
                  value={soloData.pan_number}
                  onChange={(e) => handleSoloChange('pan_number', e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength="10"
                  className={errors.pan_number ? 'error' : ''}
                />
                <span className="help-text">10-character alphanumeric code</span>
                {errors.pan_number && <span className="error-message">{errors.pan_number}</span>}
              </div>
              <div className="form-group">
                <label>GST Number</label>
                <input
                  type="text"
                  value={soloData.gst_number}
                  onChange={(e) => handleSoloChange('gst_number', e.target.value.toUpperCase())}
                  placeholder="22ABCDE1234F1Z5"
                  className={errors.gst_number ? 'error' : ''}
                />
                {errors.gst_number && <span className="error-message">{errors.gst_number}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Password <span className="required">*</span></label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={soloData.password}
                    onChange={(e) => handleSoloChange('password', e.target.value)}
                    placeholder="Enter password (min 6 characters)"
                    className={errors.password ? 'error' : ''}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="password-toggle"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <span className="error-message">{errors.password}</span>}
              </div>
              <div className="form-group">
                <label>Confirm Password <span className="required">*</span></label>
                <div className="password-input-wrapper">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={soloData.confirmPassword}
                    onChange={(e) => handleSoloChange('confirmPassword', e.target.value)}
                    placeholder="Confirm password"
                    className={errors.confirmPassword ? 'error' : ''}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="password-toggle"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.confirmPassword && <span className="error-message">{errors.confirmPassword}</span>}
              </div>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="section">
            <div className="section-title">Review Your Information</div>
            <p className="section-description">Please review all the information before submitting</p>
            <div className="review-content">
              <div className="review-section">
                <div className="review-section-header">
                  <h3>1. Personal Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">Full Name</span>
                      <div className="review-field-value">{soloData.full_name || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Bar Enrollment Number</span>
                      <div className="review-field-value">{soloData.bar_enrollment_number || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Enrollment Date</span>
                      <div className="review-field-value">{formatDate(soloData.enrollment_date)}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">State Bar Council</span>
                      <div className="review-field-value">{soloData.state_bar_council || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>2. Contact Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">Email</span>
                      <div className="review-field-value">{soloData.email || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Mobile</span>
                      <div className="review-field-value">{soloData.mobile || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>3. Address Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="review-field">
                    <span className="review-field-label">Office Address</span>
                    <div className="review-field-value">{soloData.office_address || 'Not provided'}</div>
                  </div>
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">City</span>
                      <div className="review-field-value">{soloData.city || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">State</span>
                      <div className="review-field-value">{soloData.state || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Pin Code</span>
                      <div className="review-field-value">{soloData.pin_code || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>4. Tax Details</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">PAN Number</span>
                      <div className="review-field-value">{soloData.pan_number || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">GST Number</span>
                      <div className="review-field-value">{soloData.gst_number || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="declaration-box">
              <div className="checkbox-wrapper">
                <input type="checkbox" id="soloDeclaration" required />
                <label htmlFor="soloDeclaration">
                  <strong>Declaration:</strong> I hereby declare that I am a duly enrolled advocate under the Advocates Act, 1961. The information provided above is true and correct to the best of my knowledge and belief. I understand that any false information may lead to rejection of this application and legal consequences.
                </label>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderFirmStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="section">
            <div className="section-title">Personal Information</div>
            <p className="section-description">Enter managing advocate details as per Bar Council records</p>
            <div className="form-row">
              <div className="form-group">
                <label>Firm Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={firmData.firm_name}
                  onChange={(e) => handleFirmChange('firm_name', e.target.value)}
                  placeholder="Enter registered firm name"
                  className={errors.firm_name ? 'error' : ''}
                />
                {errors.firm_name && <span className="error-message">{errors.firm_name}</span>}
              </div>
              <div className="form-group">
                <label>Full Name of Advocate Registering Firm <span className="required">*</span></label>
                <input
                  type="text"
                  value={firmData.registering_advocate_name}
                  onChange={(e) => handleFirmChange('registering_advocate_name', e.target.value)}
                  placeholder="As per Bar Council enrollment"
                  className={errors.registering_advocate_name ? 'error' : ''}
                />
                {errors.registering_advocate_name && <span className="error-message">{errors.registering_advocate_name}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Bar Enrollment Number <span style={{ color: '#666', fontSize: '12px', fontWeight: 'normal' }}>(Optional)</span></label>
                <input
                  type="text"
                  value={firmData.bar_enrollment_number}
                  onChange={(e) => handleFirmChange('bar_enrollment_number', e.target.value)}
                  placeholder="e.g., D/1234/2020"
                />
              </div>
              <div className="form-group">
                <label>Enrollment Date <span style={{ color: '#666', fontSize: '12px', fontWeight: 'normal' }}>(Optional)</span></label>
                <input
                  type="date"
                  value={firmData.enrollment_date}
                  onChange={(e) => handleFirmChange('enrollment_date', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>State Bar Council <span style={{ color: '#666', fontSize: '12px', fontWeight: 'normal' }}>(Optional)</span></label>
                <input
                  type="text"
                  value={firmData.state_bar_council}
                  onChange={(e) => handleFirmChange('state_bar_council', e.target.value)}
                  placeholder="e.g., Gujarat State Bar Council"
                />
              </div>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="section">
            <div className="section-title">Practice Information</div>
            <p className="section-description">Enter your firm details</p>
            <div className="form-row">
              <div className="form-group">
                <label>Type of Firm <span className="required">*</span></label>
                <select
                  value={firmData.firm_type}
                  onChange={(e) => handleFirmChange('firm_type', e.target.value)}
                  className={errors.firm_type ? 'error' : ''}
                >
                  <option value="">-- Select --</option>
                  <option value="Registered">Registered</option>
                  <option value="Not Registered">Not Registered</option>
                </select>
                {errors.firm_type && <span className="error-message">{errors.firm_type}</span>}
              </div>
              <div className="form-group">
                <label>Establishment Date <span style={{ color: '#666', fontSize: '12px', fontWeight: 'normal' }}>(Optional)</span></label>
                <input
                  type="date"
                  value={firmData.establishment_date}
                  onChange={(e) => handleFirmChange('establishment_date', e.target.value)}
                />
              </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="section">
            <div className="section-title">Contact Information</div>
            <p className="section-description">Enter your contact details</p>
            <div className="form-row">
              <div className="form-group">
                <label>Email Address <span className="required">*</span></label>
                <input
                  type="email"
                  value={firmData.email}
                  onChange={(e) => handleFirmChange('email', e.target.value)}
                  placeholder="firm@example.com"
                  className={errors.email ? 'error' : ''}
                />
                <span className="help-text">All communications will be sent to this email</span>
                {errors.email && <span className="error-message">{errors.email}</span>}
              </div>
              <div className="form-group">
                <label>Mobile Number <span className="required">*</span></label>
                <input
                  type="tel"
                  value={firmData.mobile}
                  onChange={(e) => handleFirmChange('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  maxLength="10"
                  className={errors.mobile ? 'error' : ''}
                />
                <span className="help-text">Format: 9876543210</span>
                {errors.mobile && <span className="error-message">{errors.mobile}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Landline Number (Optional)</label>
                <input
                  type="tel"
                  value={firmData.landline}
                  onChange={(e) => handleFirmChange('landline', e.target.value)}
                  placeholder="With STD code"
                />
              </div>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="section">
            <div className="section-title">Office Address</div>
            <p className="section-description">Enter your office address details</p>
            <div className="form-row full">
              <div className="form-group">
                <label>Office Address <span className="required">*</span></label>
                <textarea
                  value={firmData.office_address}
                  onChange={(e) => handleFirmChange('office_address', e.target.value)}
                  rows="3"
                  placeholder="Building name, street, locality"
                  className={errors.office_address ? 'error' : ''}
                />
                {errors.office_address && <span className="error-message">{errors.office_address}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>City <span className="required">*</span></label>
                <input
                  type="text"
                  value={firmData.city}
                  onChange={(e) => handleFirmChange('city', e.target.value)}
                  className={errors.city ? 'error' : ''}
                />
                {errors.city && <span className="error-message">{errors.city}</span>}
              </div>
              <div className="form-group">
                <label>District</label>
                <input
                  type="text"
                  value={firmData.district}
                  onChange={(e) => handleFirmChange('district', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>State <span className="required">*</span></label>
                <input
                  type="text"
                  value={firmData.state}
                  onChange={(e) => handleFirmChange('state', e.target.value)}
                  className={errors.state ? 'error' : ''}
                />
                {errors.state && <span className="error-message">{errors.state}</span>}
              </div>
              <div className="form-group">
                <label>PIN Code <span className="required">*</span></label>
                <input
                  type="text"
                  value={firmData.pin_code}
                  onChange={(e) => handleFirmChange('pin_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit PIN"
                  maxLength="6"
                  className={errors.pin_code ? 'error' : ''}
                />
                {errors.pin_code && <span className="error-message">{errors.pin_code}</span>}
              </div>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="section">
            <div className="section-title">Tax & Registration Details</div>
            <p className="section-description">Enter your tax and registration information</p>
            <div className="form-row">
              <div className="form-group">
                <label>PAN Number <span className="required">*</span></label>
                <input
                  type="text"
                  value={firmData.pan_number}
                  onChange={(e) => handleFirmChange('pan_number', e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength="10"
                  className={errors.pan_number ? 'error' : ''}
                />
                <span className="help-text">10-character alphanumeric code</span>
                {errors.pan_number && <span className="error-message">{errors.pan_number}</span>}
              </div>
              <div className="form-group">
                <label>GST Number</label>
                <input
                  type="text"
                  value={firmData.gst_number}
                  onChange={(e) => handleFirmChange('gst_number', e.target.value.toUpperCase())}
                  placeholder="22ABCDE1234F1Z5"
                  className={errors.gst_number ? 'error' : ''}
                />
                {errors.gst_number && <span className="error-message">{errors.gst_number}</span>}
              </div>
            </div>
          </div>
        );
      case 6:
        return (
          <div className="section">
            <div className="section-title">Review Your Information</div>
            <p className="section-description">Please review all the information before submitting</p>
            <div className="review-content">
              <div className="review-section">
                <div className="review-section-header">
                  <h3>1. Personal Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">Firm Name</span>
                      <div className="review-field-value">{firmData.firm_name || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Registering Advocate</span>
                      <div className="review-field-value">{firmData.registering_advocate_name || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Bar Enrollment Number</span>
                      <div className="review-field-value">{firmData.bar_enrollment_number || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Enrollment Date</span>
                      <div className="review-field-value">{formatDate(firmData.enrollment_date)}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">State Bar Council</span>
                      <div className="review-field-value">{firmData.state_bar_council || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>2. Practice Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">Firm Type</span>
                      <div className="review-field-value">{firmData.firm_type || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Establishment Date</span>
                      <div className="review-field-value">{formatDate(firmData.establishment_date)}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>3. Contact Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">Email</span>
                      <div className="review-field-value">{firmData.email || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Mobile</span>
                      <div className="review-field-value">{firmData.mobile || 'Not provided'}</div>
                    </div>
                    {firmData.landline && (
                      <div className="review-field">
                        <span className="review-field-label">Landline</span>
                        <div className="review-field-value">{firmData.landline}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>4. Address Information</h3>
                </div>
                <div className="review-section-body">
                  <div className="review-field">
                    <span className="review-field-label">Office Address</span>
                    <div className="review-field-value">{firmData.office_address || 'Not provided'}</div>
                  </div>
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">City</span>
                      <div className="review-field-value">{firmData.city || 'Not provided'}</div>
                    </div>
                    {firmData.district && (
                      <div className="review-field">
                        <span className="review-field-label">District</span>
                        <div className="review-field-value">{firmData.district}</div>
                      </div>
                    )}
                    <div className="review-field">
                      <span className="review-field-label">State</span>
                      <div className="review-field-value">{firmData.state || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">Pin Code</span>
                      <div className="review-field-value">{firmData.pin_code || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="review-section">
                <div className="review-section-header">
                  <h3>5. Tax Details</h3>
                </div>
                <div className="review-section-body">
                  <div className="form-row">
                    <div className="review-field">
                      <span className="review-field-label">PAN Number</span>
                      <div className="review-field-value">{firmData.pan_number || 'Not provided'}</div>
                    </div>
                    <div className="review-field">
                      <span className="review-field-label">GST Number</span>
                      <div className="review-field-value">{firmData.gst_number || 'Not provided'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="declaration-box">
              <div className="checkbox-wrapper">
                <input type="checkbox" id="firmDeclaration" required />
                <label htmlFor="firmDeclaration">
                  <strong>Declaration:</strong> I hereby declare that all partners/members of this firm are duly enrolled advocates under the Advocates Act, 1961. The information provided above is true and correct to the best of my knowledge and belief. I understand that any false information may lead to rejection of this application and legal consequences.
                </label>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="law-firm-registration">
      <div className="main-content">
        {/* Back to Home Button */}
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-start' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              backgroundColor: '#21C1B6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: '0 2px 4px rgba(33, 193, 182, 0.3)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#1AA49B';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(33, 193, 182, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#21C1B6';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(33, 193, 182, 0.3)';
            }}
          >
            <Home size={18} />
            Back to Home
          </button>
        </div>

        <div className="form-container">
          {/* Toggle Container */}
          <div className="toggle-container">
            <span className="toggle-label">Registration Type:</span>
            <div className="toggle-wrapper">
              <span 
                className={`toggle-option ${registrationType === 'SOLO' ? 'active' : ''}`}
                onClick={() => {
                  setRegistrationType('SOLO');
                  setCurrentStep(1);
                  setErrors({});
                }}
              >
                Solo User
              </span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={registrationType === 'FIRM'}
                  onChange={(e) => {
                    setRegistrationType(e.target.checked ? 'FIRM' : 'SOLO');
                    setCurrentStep(1);
                    setErrors({});
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
              <span 
                className={`toggle-option ${registrationType === 'FIRM' ? 'active' : ''}`}
                onClick={() => {
                  setRegistrationType('FIRM');
                  setCurrentStep(1);
                  setErrors({});
                }}
              >
                Firm
              </span>
            </div>
          </div>

          {/* Form Header */}
          <div className="form-header">
            <h2>{registrationType === 'SOLO' ? 'Solo Lawyer Registration Form' : 'Law Firm Registration Form'}</h2>
            <p>Please fill in all the mandatory fields marked with <span style={{ color: '#1AA49B' }}>*</span></p>
          </div>

          <div className="form-body">
            {/* Info Box for Firm */}
            {registrationType === 'FIRM' && (
              <div className="info-box">
                <strong>Important Instructions:</strong>
                All partners must be enrolled advocates. Keep your Bar Council enrollment certificate and firm documents ready for upload.
              </div>
            )}

            {/* Step Indicator */}
            <div className="step-indicator">
              {steps.map((step, index) => (
                <React.Fragment key={step.number}>
                  <div className={`step-item ${currentStep > step.number ? 'completed' : ''} ${currentStep === step.number ? 'active' : ''}`}>
                    <div className="step-number">
                      {currentStep > step.number ? <Check size={20} /> : step.number}
                    </div>
                    <div className="step-label">{step.label}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>

            {/* Form Content */}
            {registrationType === 'SOLO' ? renderSoloStep() : renderFirmStep()}

            {/* Pagination Buttons */}
            <div className="pagination-container">
              <div className="pagination-buttons">
                <button
                  type="button"
                  onClick={handlePrevious}
                  disabled={currentStep === 1}
                  className="pagination-btn prev"
                >
                  <ArrowLeft size={18} /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep(1);
                    setErrors({});
                    if (registrationType === 'SOLO') {
                      setSoloData({
                        full_name: '',
                        bar_enrollment_number: '',
                        enrollment_date: '',
                        state_bar_council: '',
                        email: '',
                        mobile: '',
                        office_address: '',
                        city: '',
                        state: '',
                        pin_code: '',
                        pan_number: '',
                        gst_number: '',
                        password: '',
                        confirmPassword: ''
                      });
                    } else {
                      setFirmData({
                        firm_name: '',
                        registering_advocate_name: '',
                        bar_enrollment_number: '',
                        enrollment_date: '',
                        state_bar_council: '',
                        firm_type: '',
                        establishment_date: '',
                        email: '',
                        mobile: '',
                        landline: '',
                        office_address: '',
                        city: '',
                        district: '',
                        state: '',
                        pin_code: '',
                        pan_number: '',
                        gst_number: ''
                      });
                    }
                  }}
                  className="pagination-btn reset"
                >
                  Reset
                </button>
                {currentStep < totalSteps ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="pagination-btn next"
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isLoading}
                    className="pagination-btn next"
                  >
                    {isLoading ? 'Submitting...' : 'Submit Application'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LawFirmRegistrationPage;
