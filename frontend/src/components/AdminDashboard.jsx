import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Settings, Shield, Activity, Users, AlertTriangle, CheckCircle2, Database, ShieldAlert, UserPlus, Plus, Loader2, RefreshCw, Trash2 } from 'lucide-react';

const API_URL = 'http://localhost:8081';

function AdminDashboard() {
  const { token, logout, user } = useContext(AuthContext);
  const [dashboardData, setDashboardData] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState({ category_name: '', min_price: '', max_price: '', expected_tax_rate: '' });
  const [newUser, setNewUser] = useState({ email: '', password: '' });

  const fetchDashboardData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/admin/dashboard?t=${Date.now()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.status === 401) {
        logout();
        return;
      }
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
      const vRes = await fetch(`${API_URL}/api/admin/vendors?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (vRes.status === 401) {
        logout();
        return;
      }
      if (vRes.ok) setVendors(await vRes.json());

      const rRes = await fetch(`${API_URL}/api/admin/rules?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (rRes.status === 401) {
        logout();
        return;
      }
      if (rRes.ok) setRules(await rRes.json());
    } catch (err) {
      console.error('Failed to fetch vendors/rules', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const uRes = await fetch(`${API_URL}/api/admin/users?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (uRes.status === 401) {
        logout();
        return;
      }
      if (uRes.ok) setUsers(await uRes.json());
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  useEffect(() => {
    if (token) {
      // Initial mount fetch
      Promise.all([
        fetchDashboardData(),
        fetchVendorsAndRules(),
        fetchUsers()
      ]).then(() => setLoading(false));

      // Auto-polling interval every 10 seconds to keep metrics in sync
      const interval = setInterval(() => {
        fetchDashboardData();
        fetchVendorsAndRules();
        fetchUsers();
      }, 10000);

      return () => clearInterval(interval);
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

  const handleDeleteUser = async (email) => {
    if (!confirm(`Are you sure you want to delete user ${email}?`)) return;
    try {
      const response = await fetch(`${API_URL}/api/admin/users/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        fetchUsers();
      } else {
        const data = await response.json();
        alert(data.detail || "Failed to delete user");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting user");
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '10px' }}>
        <Loader2 className="animate-spin" size={24} style={{ color: 'var(--sap-accent)', animation: 'spin 1.5s linear infinite' }} />
        <span style={{ fontWeight: '600', color: 'var(--sap-text-muted)' }}>Loading system dashboard...</span>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            backgroundColor: 'var(--sap-accent-light)', 
            padding: '8px', 
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(10, 110, 209, 0.15)'
          }}>
            <Activity size={20} style={{ color: 'var(--sap-accent)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--sap-text-color)', letterSpacing: '-0.01em' }}>
              Executive Admin Dashboard
            </h1>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '13px', marginTop: '2px', fontWeight: '500' }}>
              System volume stats, vendor access controls, and category compliance rules.
            </p>
          </div>
        </div>

        <button
          onClick={async () => {
            setLoading(true);
            await Promise.all([fetchDashboardData(), fetchVendorsAndRules(), fetchUsers()]);
            setLoading(false);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            backgroundColor: 'var(--sap-card-bg)',
            border: '1px solid var(--sap-border)',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
            color: 'var(--sap-text-color)',
            transition: 'background-color 0.15s, border-color 0.15s'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--sap-accent-light)';
            e.currentTarget.style.borderColor = 'var(--sap-accent)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--sap-card-bg)';
            e.currentTarget.style.borderColor = 'var(--sap-border)';
          }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
          Refresh Metrics
        </button>
      </div>

      {/* KPI Stats Panel Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        <div className="panel" style={{ padding: '16px', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--sap-text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Total Invoices</span>
            <div style={{ color: 'var(--sap-accent)', backgroundColor: 'var(--sap-accent-light)', padding: '6px', borderRadius: '4px', border: '1px solid rgba(10, 110, 209, 0.1)' }}>
              <Database size={14} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--sap-text-color)', fontFamily: 'var(--font-mono)' }}>
            {dashboardData?.total_invoices || 0}
          </div>
        </div>

        <div className="panel" style={{ padding: '16px', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--sap-text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Detected Anomalies</span>
            <div style={{ color: 'var(--sap-error-text)', backgroundColor: 'var(--sap-error-bg)', padding: '6px', borderRadius: '4px', border: '1px solid var(--sap-error-border)' }}>
              <ShieldAlert size={14} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--sap-error-text)', fontFamily: 'var(--font-mono)' }}>
            {dashboardData?.total_anomalies || 0}
          </div>
        </div>

        <div className="panel" style={{ padding: '16px', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--sap-text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Active Vendors</span>
            <div style={{ color: 'var(--sap-success-text)', backgroundColor: 'var(--sap-success-bg)', padding: '6px', borderRadius: '4px', border: '1px solid var(--sap-success-border)' }}>
              <Shield size={14} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--sap-success-text)', fontFamily: 'var(--font-mono)' }}>
            {vendors.filter(v => v.status === 'active').length} <span style={{ fontSize: '14px', color: 'var(--sap-text-muted)', fontWeight: '500' }}>/ {vendors.length}</span>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        {/* Daily Processed Spend Chart */}
        <div className="panel" style={{ height: '360px', display: 'flex', flexDirection: 'column', borderRadius: '6px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--sap-text-color)' }}>Daily Processed Spend</h3>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '12px', marginTop: '2px' }}>
              Total financial amount of invoices processed per day (grouped by upload date).
            </p>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sap-border)" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="var(--sap-text-light)" 
                  fontSize={11} 
                  fontFamily="var(--font-mono)"
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  stroke="var(--sap-text-light)" 
                  fontSize={11} 
                  fontFamily="var(--font-mono)"
                  tickLine={false} 
                  axisLine={false} 
                  width={65}
                  tickFormatter={formatYAxis} 
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--sap-card-bg)', 
                    border: '1px solid var(--sap-border)', 
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: 'var(--sap-text-color)', fontWeight: '600' }}
                  labelStyle={{ color: 'var(--sap-text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                  formatter={(value) => [`$${value.toLocaleString()}`, 'Amount']}
                />
                <Line 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="var(--sap-accent)" 
                  strokeWidth={2.5} 
                  dot={{ r: 3.5, strokeWidth: 1, fill: 'var(--sap-accent)' }} 
                  activeDot={{ r: 5, strokeWidth: 0 }} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily Invoice Volume Chart */}
        <div className="panel" style={{ height: '360px', display: 'flex', flexDirection: 'column', borderRadius: '6px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--sap-text-color)' }}>Daily Invoice Volume</h3>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '12px', marginTop: '2px' }}>
              Total number of unique invoices processed per day (grouped by upload date).
            </p>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sap-border)" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="var(--sap-text-light)" 
                  fontSize={11} 
                  fontFamily="var(--font-mono)"
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  stroke="var(--sap-text-light)" 
                  fontSize={11} 
                  fontFamily="var(--font-mono)"
                  tickLine={false} 
                  axisLine={false} 
                  width={30}
                  allowDecimals={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--sap-card-bg)', 
                    border: '1px solid var(--sap-border)', 
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: 'var(--sap-text-color)', fontWeight: '600' }}
                  labelStyle={{ color: 'var(--sap-text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                  formatter={(value) => [value, 'Invoices']}
                />
                <Line 
                  type="monotone" 
                  dataKey="count" 
                  stroke="var(--sap-success-text)" 
                  strokeWidth={2.5} 
                  dot={{ r: 3.5, strokeWidth: 1, fill: 'var(--sap-success-text)' }} 
                  activeDot={{ r: 5, strokeWidth: 0 }} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
        <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column', borderRadius: '6px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--sap-text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={16} style={{ color: 'var(--sap-text-light)' }} />
              Vendor Access Control
            </h3>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '12px', marginTop: '2px' }}>
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
                    <td style={{ fontWeight: '600', color: 'var(--sap-text-color)' }}>{v.vendor_name}</td>
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
                        style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '4px' }}
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
        <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column', borderRadius: '6px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--sap-text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={16} style={{ color: 'var(--sap-text-light)' }} />
              Category Price Limits
            </h3>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '12px', marginTop: '2px' }}>
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
                    <td style={{ fontWeight: '600', color: 'var(--sap-text-color)' }}>{r.category_name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>${r.min_price || '0'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>${r.max_price || 'Any'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{r.expected_tax_rate ? `${r.expected_tax_rate}%` : 'Any'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Quick Add Rule Form */}
          <form onSubmit={addRule} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              placeholder="Category Name" 
              value={newRule.category_name} 
              onChange={e => setNewRule({...newRule, category_name: e.target.value})}
              className="form-input"
              style={{ flex: 1, minWidth: '90px', padding: '6px 10px', fontSize: '12px', height: '30px', borderRadius: '4px' }}
              required
            />
            <input 
              type="number" 
              placeholder="Min $" 
              value={newRule.min_price} 
              onChange={e => setNewRule({...newRule, min_price: e.target.value})}
              className="form-input"
              style={{ width: '55px', padding: '6px 10px', fontSize: '12px', height: '30px', borderRadius: '4px' }}
            />
            <input 
              type="number" 
              placeholder="Max $" 
              value={newRule.max_price} 
              onChange={e => setNewRule({...newRule, max_price: e.target.value})}
              className="form-input"
              style={{ width: '55px', padding: '6px 10px', fontSize: '12px', height: '30px', borderRadius: '4px' }}
            />
            <input 
              type="number" 
              placeholder="Tax %" 
              value={newRule.expected_tax_rate} 
              onChange={e => setNewRule({...newRule, expected_tax_rate: e.target.value})}
              className="form-input"
              style={{ width: '50px', padding: '6px 10px', fontSize: '12px', height: '30px', borderRadius: '4px' }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '0 8px', height: '30px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={14} />
            </button>
          </form>
        </div>

        {/* Column 3: User Management */}
        <div className="panel" style={{ height: '380px', display: 'flex', flexDirection: 'column', borderRadius: '6px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--sap-text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={16} style={{ color: 'var(--sap-text-light)' }} />
              User Account Control
            </h3>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '12px', marginTop: '2px' }}>
              Create and monitor operator login permissions.
            </p>
          </div>
          
          <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto', marginBottom: '14px' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <th>Operator Email</th>
                  <th>Role</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: '600', color: 'var(--sap-text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                      {u.email}
                    </td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-green' : 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {u.email !== user?.email ? (
                        <button
                          onClick={() => handleDeleteUser(u.email)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--sap-error-text)',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            transition: 'background-color 0.15s'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--sap-error-bg)'}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          title="Delete User"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--sap-text-muted)', fontStyle: 'italic' }}>Active Admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Quick Add User Form */}
          <form onSubmit={handleAddUser} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <input 
              type="email" 
              placeholder="new@experto.ai" 
              value={newUser.email} 
              onChange={e => setNewUser({...newUser, email: e.target.value})}
              className="form-input"
              style={{ flex: 1, minWidth: '100px', padding: '6px 10px', fontSize: '12px', height: '30px', borderRadius: '4px' }}
              required
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={newUser.password} 
              onChange={e => setNewUser({...newUser, password: e.target.value})}
              className="form-input"
              style={{ width: '80px', padding: '6px 10px', fontSize: '12px', height: '30px', borderRadius: '4px' }}
              required
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '0 8px', height: '30px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '12px' }}>
              <UserPlus size={14} /> Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
