import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './Visitors.css';

const Visitors = () => {
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    date: ''
  });

  useEffect(() => {
    fetchVisitors();
  }, [filters]);

  const fetchVisitors = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.date) params.date = filters.date;

      const response = await axios.get('/visitors', { params });
      setVisitors(response.data.visitors || []);
    } catch (error) {
      console.error('Error fetching visitors:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="admin-container">
      <div className="sidebar">
        <h2>Admin Panel</h2>
        <nav>
          <ul>
            <li><Link to="/dashboard">Dashboard</Link></li>
            <li><Link to="/meetings">Meetings</Link></li>
            <li><Link to="/visitors" className="active">Visitors</Link></li>
            <li><Link to="/config">Configuration</Link></li>
          </ul>
        </nav>
      </div>
      <div className="main-content">
        <div className="content-header">
          <h1>All Visitors</h1>
        </div>

        <div className="card">
          <h2>Filters</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
            <div className="form-group">
              <label>Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">All Statuses</option>
                <option value="Inside">Inside</option>
                <option value="Exited">Exited</option>
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={filters.date}
                onChange={(e) => setFilters({ ...filters, date: e.target.value })}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div style={{ textAlign: 'center', padding: '40px' }}>Loading visitors...</div>
          </div>
        ) : (
          <div className="card">
            <h2>Visitors ({visitors.length})</h2>
            {visitors.length === 0 ? (
              <p style={{ color: '#666', padding: '20px' }}>No visitors found.</p>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Category</th>
                      <th>Employee to Meet</th>
                      <th>Check In</th>
                      <th>Check Out</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitors.map(visitor => (
                      <tr key={visitor._id}>
                        <td>
                          {visitor.photograph ? (
                            <img
                              src={`http://localhost:5001${visitor.photograph}`}
                              alt={visitor.name}
                              style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '4px' }}
                            />
                          ) : (
                            <span style={{ color: '#999' }}>No photo</span>
                          )}
                        </td>
                        <td><strong>{visitor.name}</strong></td>
                        <td>{visitor.phoneNumber}</td>
                        <td>
                          {visitor.visitorCategory === 'Others' && visitor.visitorCategoryDetail
                            ? visitor.visitorCategoryDetail
                            : visitor.visitorCategory}
                        </td>
                        <td>{visitor.employeeToMeet}</td>
                        <td>{formatDate(visitor.checkInTime)}</td>
                        <td>{formatDate(visitor.checkOutTime)}</td>
                        <td>
                          <span style={{
                            backgroundColor: visitor.status === 'Inside' ? '#27ae60' : '#95a5a6',
                            color: 'white',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}>
                            {visitor.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Visitors;
