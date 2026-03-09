import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Dashboard.css';

const Dashboard = ({ setIsAuthenticated }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await axios.get('/admin/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    delete axios.defaults.headers.common['Authorization'];
    setIsAuthenticated(false);
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="admin-container">
        <div className="main-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="sidebar">
        <h2>Admin Panel</h2>
        <nav>
          <ul>
            <li><Link to="/dashboard" className="active">Dashboard</Link></li>
            <li><Link to="/meetings">Meetings</Link></li>
            <li><Link to="/visitors">Visitors</Link></li>
            <li><Link to="/config">Configuration</Link></li>
            <li><button onClick={handleLogout} className="logout-btn">Logout</button></li>
          </ul>
        </nav>
      </div>
      <div className="main-content">
        <div className="content-header">
          <h1>Dashboard</h1>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <h3>Visitors Today</h3>
            <div className="value">{stats?.visitorsToday || 0}</div>
          </div>
          <div className="stat-card">
            <h3>Visitors Inside</h3>
            <div className="value">{stats?.visitorsInside || 0}</div>
          </div>
          <div className="stat-card">
            <h3>Meetings Today</h3>
            <div className="value">{stats?.meetingsToday || 0}</div>
          </div>
          <div className="stat-card">
            <h3>Total Meetings</h3>
            <div className="value">{stats?.totalMeetings || 0}</div>
          </div>
        </div>

        <div className="card">
          <h2>Quick Actions</h2>
          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
            <Link to="/meetings" className="btn btn-primary">View All Meetings</Link>
            <Link to="/visitors" className="btn btn-primary">View All Visitors</Link>
            <Link to="/config" className="btn btn-secondary">Settings</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
