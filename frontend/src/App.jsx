import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { FileText, Heart, Sparkles } from 'lucide-react'
import Home from './pages/Home'
import Favorites from './pages/Favorites'
import './App.css'

function Navigation() {
  const location = useLocation()
  
  return (
    <nav className="nav">
      <div className="nav-brand">
        <Sparkles size={24} />
        <span>Interview Prep</span>
      </div>
      <div className="nav-links">
        <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
          <FileText size={20} />
          <span>Prepare</span>
        </Link>
        <Link to="/favorites" className={`nav-link ${location.pathname === '/favorites' ? 'active' : ''}`}>
          <Heart size={20} />
          <span>Favorites</span>
        </Link>
      </div>
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navigation />
        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/favorites" element={<Favorites />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
