import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Heart, Trash2, Eye, Loader2, X, ExternalLink, Building2 } from 'lucide-react'
import './Favorites.css'

export default function Favorites() {
  const [favorites, setFavorites] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingIds, setDeletingIds] = useState(new Set())
  const [selectedQuestion, setSelectedQuestion] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    fetchFavorites()
  }, [])

  const fetchFavorites = async () => {
    try {
      const response = await axios.get('/api/favorites')
      setFavorites(response.data)
    } catch (error) {
      console.error('Error fetching favorites:', error)
    } finally {
      setLoading(false)
    }
  }

  const removeFavorite = async (id) => {
    if (!confirm('Remove this question from favorites?')) return
    
    setDeletingIds(prev => new Set(prev).add(id))
    try {
      await axios.delete(`/api/favorites/${id}`)
      setFavorites(prev => prev.filter(f => f.id !== id))
    } catch (error) {
      alert('Failed to remove')
    } finally {
      setDeletingIds(prev => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    }
  }

  const openModal = (question) => {
    setSelectedQuestion(question)
    setModalOpen(true)
  }

  const getDifficultyColor = (d) => ({ easy: '#4CAF50', medium: '#FF9800', hard: '#f44336' }[d] || '#888')
  
  const getCategoryColor = (cat) => ({
    technical: '#6c63ff',
    behavioral: '#FF9800',
    situational: '#2196F3',
    company_specific: '#4CAF50'
  }[cat] || '#888')

  if (loading) {
    return (
      <div className="favorites-loading">
        <Loader2 className="spin" size={48} />
        <p>Loading favorites...</p>
      </div>
    )
  }

  return (
    <div className="favorites">
      <div className="favorites-header">
        <h1>Favorites</h1>
        <p>{favorites.length} saved question{favorites.length !== 1 ? 's' : ''}</p>
      </div>

      {favorites.length === 0 ? (
        <div className="favorites-empty">
          <Heart size={64} />
          <h3>No favorites yet</h3>
          <p>Save questions from the Prepare tab to review them later</p>
        </div>
      ) : (
        <div className="favorites-list">
          {favorites.map((fav) => (
            <div key={fav.id} className="fav-card">
              <div className="fav-card-header">
                <div className="fav-badges">
                  <span className="fav-category" style={{ backgroundColor: getCategoryColor(fav.category) + '20', color: getCategoryColor(fav.category) }}>
                    {fav.category.replace('_', ' ')}
                  </span>
                  {fav.source === 'web_search' && (
                    <span className="fav-verified">Verified</span>
                  )}
                </div>
                <button 
                  className="delete-btn"
                  onClick={() => removeFavorite(fav.id)}
                  disabled={deletingIds.has(fav.id)}
                >
                  {deletingIds.has(fav.id) ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}
                </button>
              </div>

              {fav.company && (
                <div className="fav-company">
                  <Building2 size={14} />
                  <span>{fav.company}</span>
                </div>
              )}

              <p className="fav-question">{fav.question}</p>

              {fav.source === 'web_search' && fav.source_url && (
                <a href={fav.source_url} target="_blank" rel="noopener noreferrer" className="fav-source-link">
                  <ExternalLink size={14} />
                  {fav.source_url.substring(0, 40)}...
                </a>
              )}

              <button className="fav-view-btn" onClick={() => openModal(fav)}>
                <Eye size={18} />
                View Answer
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Answer Modal */}
      {modalOpen && selectedQuestion && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModalOpen(false)}>
              <X size={24} />
            </button>
            
            <div className="modal-badges">
              <span className="modal-category" style={{ backgroundColor: getCategoryColor(selectedQuestion.category) }}>
                {selectedQuestion.category.replace('_', ' ')}
              </span>
            </div>
            
            <div className="modal-section">
              <span className="modal-label">QUESTION</span>
              <p className="modal-question">{selectedQuestion.question}</p>
            </div>
            
            <div className="modal-divider" />
            
            <div className="modal-section">
              <span className="modal-label">ANSWER</span>
              <p className="modal-answer">{selectedQuestion.answer}</p>
            </div>
            
            {selectedQuestion.source === 'web_search' && selectedQuestion.source_url && (
              <a href={selectedQuestion.source_url} target="_blank" rel="noopener noreferrer" className="modal-source">
                <ExternalLink size={16} />
                View Original Source
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
