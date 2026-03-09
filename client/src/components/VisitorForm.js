import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import axios from 'axios';
import './VisitorForm.css';

const VisitorForm = ({ config }) => {
  const navigate = useNavigate();
  const webcamRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    phoneNumber: '',
    email: '',
    company: '',
    visitorCategory: 'Client',
    visitorCategoryDetail: '',
    employeeToMeet: '',
    department: '',
    purpose: '',
    vehicleNumber: '',
    itemCarried: '',
    meetingRoom: ''
  });
  const [capturing, setCapturing] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);

  // Fetch visitor categories from API
  React.useEffect(() => {
    axios.get('/visitors/categories')
      .then(response => {
        const cats = Object.keys(response.data.categories || {});
        setCategories(cats);
      })
      .catch(err => {
        console.error('Error fetching categories:', err);
        // Fallback categories
        setCategories(['Client', 'Interview Candidate', 'Vendor', 'Delivery', 'Contractor', 'Others']);
      });
  }, []);

  const capturePhoto = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setPhoto(imageSrc);
      setCapturing(false);
    }
  }, []);

  const handleInputChange = (e) => {
    let value = e.target.value;
    
    // Auto-add country code for phone numbers
    if (e.target.name === 'phoneNumber') {
      value = value.replace(/^\+91/, '').replace(/^91/, '').trim();
    }
    
    // Auto-uppercase for vehicle number
    if (e.target.name === 'vehicleNumber') {
      value = value.toUpperCase();
    }
    
    setFormData({
      ...formData,
      [e.target.name]: value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.name || !formData.phoneNumber || !formData.employeeToMeet || !formData.purpose || !formData.visitorCategory) {
      setError('Please fill in all required fields');
      return;
    }

    if (formData.visitorCategory === 'Others' && !formData.visitorCategoryDetail.trim()) {
      setError('Please specify visitor type when selecting Others');
      return;
    }

    if (!photo) {
      setError('Please capture a photo');
      return;
    }

    setLoading(true);

    try {
      // Convert base64 to blob
      const response = await fetch(photo);
      const blob = await response.blob();
      const file = new File([blob], 'visitor-photo.jpg', { type: 'image/jpeg' });

      // Ensure phone number has country code
      let phoneNumber = formData.phoneNumber.trim();
      if (!phoneNumber.startsWith('+')) {
        phoneNumber = '+91' + phoneNumber;
      }

      // Create form data
      const submitData = new FormData();
      submitData.append('name', formData.name.trim());
      submitData.append('phoneNumber', phoneNumber);
      submitData.append('email', formData.email.trim() || '');
      submitData.append('company', formData.company.trim() || '');
      submitData.append('visitorCategory', formData.visitorCategory);
      if (formData.visitorCategory === 'Others') {
        submitData.append('visitorCategoryDetail', formData.visitorCategoryDetail.trim());
      }
      submitData.append('employeeToMeet', formData.employeeToMeet.trim());
      submitData.append('department', formData.department.trim() || '');
      submitData.append('purpose', formData.purpose.trim());
      submitData.append('vehicleNumber', formData.vehicleNumber.trim().toUpperCase() || '');
      submitData.append('itemCarried', formData.itemCarried.trim() || '');
      submitData.append('meetingRoom', formData.meetingRoom.trim() || '');
      submitData.append('photograph', file);

      const result = await axios.post('/visitors/entry', submitData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 30000
      });

      if (result.data.visitor) {
        localStorage.setItem('visitorData', JSON.stringify(result.data.visitor));
        setSubmitting(true);
        setLoading(false);
        
        setTimeout(() => {
          navigate('/thank-you', { replace: true });
        }, 2000);
      } else {
        setError('Entry successful but failed to get visitor data. Please contact support.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Error submitting form:', err);
      let serverError =
        err.response?.data?.error ||
        err.response?.data?.details ||
        err.message;

      if (err.message === 'Network Error') {
        serverError = 'Cannot reach workplace server. Please ensure the backend is running on port 5001.';
      }

      setError(serverError || 'Failed to submit form. Please try again.');
      setLoading(false);
    }
  };

  // Show loading screen after successful submission
  if (submitting) {
    return (
      <div className="visitor-form-screen">
        <div className="submission-loading">
          <div className="loading-spinner"></div>
          <p>Processing your entry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="visitor-form-screen">
      <div className="form-wrapper">
        <div className="form-header">
          <h1 className="form-title">Visitor Registration</h1>
          <p className="form-subtitle">Please provide the following information</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="visitor-form">
          {/* Row 1: Name + Company */}
          <div className="form-row">
            <div className="form-group">
              <label>Full Name <span className="required">*</span></label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                placeholder="Enter your full name"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Company / Organization</label>
              <input
                type="text"
                name="company"
                value={formData.company}
                onChange={handleInputChange}
                placeholder="Company name"
              />
            </div>
          </div>

          {/* Row 2: Email + Phone */}
          <div className="form-row">
            <div className="form-group">
              <label>Work Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="work.email@company.com"
              />
            </div>

            <div className="form-group">
              <label>Phone Number <span className="required">*</span></label>
              <div className="phone-input-group">
                <span className="phone-prefix">+91</span>
                <input
                  type="tel"
                  name="phoneNumber"
                  value={formData.phoneNumber.replace(/^\+91/, '')}
                  onChange={handleInputChange}
                  required
                  placeholder="9876543210"
                  maxLength="10"
                />
              </div>
            </div>
          </div>

          {/* Row 3: Visitor Category + Employee to Meet */}
          <div className="form-row">
            <div className="form-group">
              <label>Visitor Type <span className="required">*</span></label>
              <select
                name="visitorCategory"
                value={formData.visitorCategory}
                onChange={handleInputChange}
                required
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Employee / Department to Meet <span className="required">*</span></label>
              <input
                type="text"
                name="employeeToMeet"
                value={formData.employeeToMeet}
                onChange={handleInputChange}
                required
                placeholder="Name or department"
              />
            </div>
          </div>

          {formData.visitorCategory === 'Others' && (
            <div className="form-group">
              <label>Specify Visitor Type <span className="required">*</span></label>
              <input
                type="text"
                name="visitorCategoryDetail"
                value={formData.visitorCategoryDetail}
                onChange={handleInputChange}
                placeholder="e.g., Auditor, Consultant, Investor"
                required
              />
            </div>
          )}

          {/* Row 4: Department + Meeting Room */}
          <div className="form-row">
            <div className="form-group">
              <label>Department</label>
              <input
                type="text"
                name="department"
                value={formData.department}
                onChange={handleInputChange}
                placeholder="Department name"
              />
            </div>

            <div className="form-group">
              <label>Meeting Room</label>
              <input
                type="text"
                name="meetingRoom"
                value={formData.meetingRoom}
                onChange={handleInputChange}
                placeholder="Room number or name"
              />
            </div>
          </div>

          {/* Purpose */}
          <div className="form-group">
            <label>Purpose of Visit <span className="required">*</span></label>
            <textarea
              name="purpose"
              value={formData.purpose}
              onChange={handleInputChange}
              required
              rows="3"
              placeholder="e.g., Client meeting, Interview, Vendor visit, Delivery, Contractor work"
            />
          </div>

          {/* Row 5: Vehicle + Items */}
          <div className="form-row">
            <div className="form-group">
              <label>Vehicle Number</label>
              <input
                type="text"
                name="vehicleNumber"
                value={formData.vehicleNumber}
                onChange={handleInputChange}
                placeholder="Vehicle registration"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label>Items Carried</label>
              <input
                type="text"
                name="itemCarried"
                value={formData.itemCarried}
                onChange={handleInputChange}
                placeholder="Brief description"
              />
            </div>
          </div>

          {/* Photo Section */}
          <div className="photo-section">
            <label>Photograph <span className="required">*</span></label>
            <p className="photo-notice">
              Your photo will be used for security and identification purposes only.
            </p>
            {!capturing && !photo && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCapturing(true)}
              >
                Capture Photo
              </button>
            )}

            {capturing && (
              <div className="webcam-container">
                <Webcam
                  audio={false}
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  width="100%"
                  videoConstraints={{
                    facingMode: 'user'
                  }}
                />
                <div className="webcam-controls">
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={capturePhoto}
                  >
                    Capture
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setCapturing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {photo && !capturing && (
              <div className="photo-preview">
                <img src={photo} alt="Visitor" />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setPhoto(null);
                    setCapturing(true);
                  }}
                >
                  Retake Photo
                </button>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/')}
            >
              Back
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Submitting...' : 'Submit Registration'}
            </button>
          </div>
        </form>
      </div>

      <div className="branding-footer">
        Workplace Visitor Management System
      </div>
    </div>
  );
};

export default VisitorForm;
