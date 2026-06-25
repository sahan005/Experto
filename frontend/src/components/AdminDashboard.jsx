import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Settings, Shield, Activity, Users, AlertTriangle, CheckCircle2, Database, ShieldAlert, UserPlus, Plus, Loader2 } from 'lucide-react';

const API_URL = 'http://localhost:8081';

function AdminDashboard() {
  const { token } = useContext(AuthContext);
  const [dashboardData, setDashboardData] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState({ category_name: '', min_price: '', max_price: '', expected_tax_rate: '' });
  const [newUser, setNewUser] = useState({ email: '', password: '' });

  const fetchDashboardData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/admin/dashboard`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setDashboardData(data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data', err);
    }
  };

  const fetchVendorsAndRules = async () => {
    try {
      const vRes = await fetch(`${API_URL}/api/admin/vendors`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (vRes.ok) setVendors(await vRes.json());

      const rRes = await fetch(`${API_URL}/api/admin/rules`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (rRes.ok) setRules(await rRes.json());
    } catch (err) {
      console.error('Failed to fetch vendors/rules', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const uRes = await fetch(`${API_URL}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (uRes.ok) setUsers(await uRes.json());
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  useEffect(() => {
    if (token) {
      Promise.all([fetchDashboardData(), fetchVendorsAndRules(), fetchUsers()]).then(() => setLoading(false));
    }
  }, [token]);

  const toggleVendorStatus = async (vendor) => {
    const newStatus = vendor.status === 'active' ? 'blocked' : 'active';
    try {
      await fetch(`${API_URL}/api/admin/vendors/${encodeURIComponent(vendor.vendor_name)}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      fetchVendorsAndRules();
    } catch (err) {
      console.error(err);
    }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!newRule.category_name) return;
    try {
      await fetch(`${API_URL}/api/admin/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          category_name: newRule.category_name,
          min_price: newRule.min_price ? parseFloat(newRule.min_price) : null,
          max_price: newRule.max_price ? parseFloat(newRule.max_price) : null,
          expected_tax_rate: newRule.expected_tax_rate ? parseFloat(newRule.expected_tax_rate) : null
        })
      });
      setNewRule({ category_name: '', min_price: '', max_price: '', expected_tax_rate: '' });
      fetchVendorsAndRules();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUser.email || !newUser.password) return;
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: newUser.email,
          password: newUser.password
        })
      });
      if (response.ok) {
        setNewUser({ email: '', password: '' });
        fetchUsers();
      } else {
        const errData = await response.json();
        alert(errData.detail || 'Failed to add user');
      }
    } catch (err) {
      console.error('Error adding user', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '10px' }}>
        <Loader2 className="animate-spin" size={24} style={{ color: 'var(--accent-primary)', animation: 'spin 1.5s linear infinite' }} />
        <span style={{ fontWeight: '600', color: 'var(--text-muted)' }}>Loading system dashboard...</span>
      </div>
    );
  }

  const chartData = dashboardData?.daily_totals?.map(item => ({
    date: item.date,
    amount: item.amount,
    count: item.count
  })) || [];

  const formatYAxis = (value) => {
    if (value === 0) return '$0';
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', animation: 'slide-in 0.4s ease', width: '100%', maxWidth: '100%', alignItems: 'stretch' }}>
      {/* Dashboard Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ 
          backgroundColor: '#eef2ff', 
          padding: '8px', 
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Activity size={22} style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
            Executive Admin Dashboard
          </h1>
          <p style={{ color: 'var(--text-light)', fontSize: '13px', marginTop: '2px', fontWeight: '500' }}>
            System volume stats, vendor access controls, and category compliance rules.
          </p>
        </div>
      </div>

      {/* KPI Stats Panel Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        <div className="panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-light)' }}>Total Uploaded Invoices</span>
            <div style={{ color: 'var(--accent-primary)', backgroundColor: '#f0f3ff', padding: '6px', borderRadius: '8px' }}>
              <Database size={16} />
            </div>
          </div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {dashboardData?.total_invoices || 0}
          </div>
        </div>

        <div className="panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-light)' }}>Detected Anomalies</span>
            <div style={{ color: 'var(--status-red)', backgroundColor: 'var(--status-red-bg)', padding: '6px', borderRadius: '8px' }}>
              <ShieldAlert size={16} />
            </div>
          </div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--status-red)', fontFamily: 'var(--font-mono)' }}>
            {dashboardData?.total_anomalies || 0}
          </div>
        </div>

        <div className="panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-light)' }}>Active Vendor Profiles</span>
            <div style={{ color: 'var(--status-green)', backgroundColor: 'var(--status-green-bg)', padding: '6px', borderRadius: '8px' }}>
              <Shield size={16} />
            </div>
          </div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--status-green)', fontFamily: 'var(--font-mono)' }}>
            {vendors.filter(v => v.status === 'active').length} <span style={{ fontSize: '14px', color: 'var(--text-light)', fontWeight: '500' }}>/ {vendors.length}</span>
          </div>
        </div>
      </div>

      {/* Chart Panel */}
      <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Daily Processing Volume</h3>
          <p style={{ color: 'var(--text-light)', fontSize: '12px', marginTop: '2px' }}>
            Aggregated transaction amounts and volume records tracked over time.
          </p>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="var(--text-light)" 
                fontSize={11} 
                fontFamily="var(--font-mono)"
                tickLine={false} 
                axisLine={false} 
              />
              <YAxis 
                stroke="var(--text-light)" 
                fontSize={11} 
                fontFamily="var(--font-mono)"
                tickLine={false} 
                axisLine={false} 
                width={65}
                tickFormatter={formatYAxis} 
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--bg-card)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '10px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px'
                }}
                itemStyle={{ color: 'var(--text-main)', fontWeight: '600' }}
                labelStyle={{ color: 'var(--text-light)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
              />
              <Line 
                type="monotone" 
                dataKey="amount" 
                stroke="var(--accent-primary)" 
                strokeWidth={3} 
                dot={{ r: 4, strokeWidth: 1, fill: 'var(--accent-primary)' }} 
                activeDot={{ r: 6, strokeWidth: 0 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Spacious 3-Column Management Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
        gap: '24px',
        alignItems: 'start'
      }}>
        {/* Column 1: Vendor Access Control */}
        <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={18} style={{ color: 'var(--text-light)' }} />
              Vendor Access Control
            </h3>
            <p style={{ color: 'var(--text-light)', fontSize: '12px', marginTop: '2px' }}>
              Block or authorize vendor invoice processing.
            </p>
          </div>
          
          <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <th>Vendor</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.vendor_name}>
                    <td style={{ fontWeight: '600', color: 'var(--text-main)' }}>{v.vendor_name}</td>
                    <td>
                      {v.status === 'active' ? (
                        <span className="badge badge-green">Active</span>
                      ) : (
                        <span className="badge badge-red">Blocked</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        onClick={() => toggleVendorStatus(v)}
                        className={`btn ${v.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
                        style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px' }}
                      >
                        {v.status === 'active' ? 'Block' : 'Unblock'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 2: Category Compliance Rules */}
        <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={18} style={{ color: 'var(--text-light)' }} />
              Category Price Limits
            </h3>
            <p style={{ color: 'var(--text-light)', fontSize: '12px', marginTop: '2px' }}>
              Set price caps and tax rate compliance rules.
            </p>
          </div>
          
          <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto', marginBottom: '14px' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <th>Category</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Tax</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.category_name}>
                    <td style={{ fontWeight: '600', color: 'var(--text-main)' }}>{r.category_name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>${r.min_price || '0'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>${r.max_price || 'Any'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{r.expected_tax_rate ? `${r.expected_tax_rate}%` : 'Any'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Quick Add Rule Form */}
          <form onSubmit={addRule} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              placeholder="Category Name" 
              value={newRule.category_name} 
              onChange={e => setNewRule({...newRule, category_name: e.target.value})}
              className="form-input"
              style={{ flex: 1, minWidth: '100px', padding: '6px 10px', fontSize: '12px', height: '32px' }}
              required
            />
            <input 
              type="number" 
              placeholder="Min $" 
              value={newRule.min_price} 
              onChange={e => setNewRule({...newRule, min_price: e.target.value})}
              className="form-input"
              style={{ width: '60px', padding: '6px 10px', fontSize: '12px', height: '32px' }}
            />
            <input 
              type="number" 
              placeholder="Max $" 
              value={newRule.max_price} 
              onChange={e => setNewRule({...newRule, max_price: e.target.value})}
              className="form-input"
              style={{ width: '60px', padding: '6px 10px', fontSize: '12px', height: '32px' }}
            />
            <input 
              type="number" 
              placeholder="Tax %" 
              value={newRule.expected_tax_rate} 
              onChange={e => setNewRule({...newRule, expected_tax_rate: e.target.value})}
              className="form-input"
              style={{ width: '55px', padding: '6px 10px', fontSize: '12px', height: '32px' }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '6px 10px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={14} />
            </button>
          </form>
        </div>

        {/* Column 3: User Management */}
        <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} style={{ color: 'var(--text-light)' }} />
              User Account Control
            </h3>
            <p style={{ color: 'var(--text-light)', fontSize: '12px', marginTop: '2px' }}>
              Create and monitor operator login permissions.
            </p>
          </div>
          
          <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto', marginBottom: '14px' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <th>Operator Email</th>
                  <th style={{ textAlign: 'right' }}>Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: '600', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                      {u.email}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`badge ${u.role === 'admin' ? 'badge-green' : 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Quick Add User Form */}
          <form onSubmit={handleAddUser} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input 
              type="email" 
              placeholder="new@experto.ai" 
              value={newUser.email} 
              onChange={e => setNewUser({...newUser, email: e.target.value})}
              className="form-input"
              style={{ flex: 1, minWidth: '120px', padding: '6px 10px', fontSize: '12px', height: '32px' }}
              required
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={newUser.password} 
              onChange={e => setNewUser({...newUser, password: e.target.value})}
              className="form-input"
              style={{ width: '90px', padding: '6px 10px', fontSize: '12px', height: '32px' }}
              required
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '6px 10px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '12px' }}>
              <UserPlus size={14} /> Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
