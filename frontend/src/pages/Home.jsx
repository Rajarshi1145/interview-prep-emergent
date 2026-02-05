import React, { useState, useRef } from 'react'
import axios from 'axios'
import { 
  Search, Upload, Loader2, ChevronRight, Heart, ExternalLink, 
  X, Sparkles, Code, Users, Lightbulb, Building2, FileText,
  Plus, Eye, BookOpen, Zap
} from 'lucide-react'
import './Home.css'

export default function Home() {
  const [jobDescription, setJobDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [questions, setQuestions] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('technical')
  const [savingIds, setSavingIds] = useState(new Set())
  const [selectedQuestion, setSelectedQuestion] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [streamStatus, setStreamStatus] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const eventSourceRef = useRef(null)

  const generateQuestionsStream = async () => {
    if (!jobDescription.trim()) {
      alert('Please enter a job description')
      return
    }
    
    // Reset state
    setLoading(true)
    setIsStreaming(true)
    setQuestions({
      technical: [],
      behavioral: [],
      situational: [],
      company_specific: [],
      job_analysis: null
    })
    setStreamStatus('Starting...')
    setSelectedCategory('behavioral') // Start with behavioral since they arrive first
    
    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    
    try {
      // Use fetch with streaming for POST request (EventSource only supports GET)
      const response = await fetch('/api/generate-questions-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ job_description: jobDescription })
      })
      
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        let currentEvent = null
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7)
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6))
              handleStreamEvent(currentEvent, data)
            } catch (e) {
              console.error('Parse error:', e)
            }
            currentEvent = null
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error)
      alert('Failed to generate questions: ' + error.message)
    } finally {
      setLoading(false)
      setIsStreaming(false)
      setStreamStatus('')
    }
  }
  
  const handleStreamEvent = (event, data) => {
    switch (event) {
      case 'status':
        setStreamStatus(data.message)
        break
      case 'job_analysis':
        setQuestions(prev => ({ ...prev, job_analysis: data }))
        break
      case 'question':
        setQuestions(prev => ({
          ...prev,
          [data.category]: [...(prev[data.category] || []), data]
        }))
        // Auto-switch to category when first question arrives
        if (data.category === 'technical') {
          setSelectedCategory('technical')
        }
        break
      case 'complete':
        setStreamStatus('Complete!')
        setTimeout(() => setStreamStatus(''), 2000)
        break
      case 'error':
        alert('Error: ' + data.message)
        break
    }
  }

  const loadMoreQuestions = async () => {
    if (!questions?.job_analysis) return
    setLoadingMore(true)
    try {
      const currentQuestions = questions[selectedCategory] || []
      const response = await axios.post('/api/load-more', {
        job_description: jobDescription,
        category: selectedCategory,
        existing_questions: currentQuestions.map(q => q.question),
        skills: questions.job_analysis.technical_skills || [],
        domain: questions.job_analysis.domain,
        job_title: questions.job_analysis.job_title,
        seniority: questions.job_analysis.seniority_level,
      })
      if (response.data.questions?.length > 0) {
        setQuestions(prev => ({
          ...prev,
          [selectedCategory]: [...(prev[selectedCategory] || []), ...response.data.questions]
        }))
      } else {
        alert('No more unique questions available')
      }
    } catch (error) {
      alert('Failed to load more questions')
    } finally {
      setLoadingMore(false)
    }
  }

  const saveToFavorites = async (question) => {
    setSavingIds(prev => new Set(prev).add(question.id))
    try {
      await axios.post('/api/favorites', {
        question: question.question,
        answer: question.answer,
        category: question.category,
        job_description: question.job_description,
        source: question.source,
        source_url: question.source_url,
        company: question.company,
        skill_tag: question.skill_tag,
      })
      alert('Saved to favorites!')
    } catch {
      alert('Failed to save')
    } finally {
      setSavingIds(prev => {
        const s = new Set(prev)
        s.delete(question.id)
        return s
      })
    }
  }

  const openModal = (question) => {
    setSelectedQuestion(question)
    setModalOpen(true)
  }

  const categories = [
    { key: 'technical', label: 'Technical', icon: Code, color: '#6c63ff' },
    { key: 'company_specific', label: 'Company', icon: Building2, color: '#4CAF50' },
    { key: 'behavioral', label: 'Behavioral', icon: Users, color: '#FF9800' },
    { key: 'situational', label: 'Situational', icon: Lightbulb, color: '#2196F3' },
  ]

  const currentQuestions = questions ? (questions[selectedCategory] || []) : []
  const jobAnalysis = questions?.job_analysis

  const getDifficultyColor = (d) => ({ easy: '#4CAF50', medium: '#FF9800', hard: '#f44336' }[d] || '#888')

  return (
    <div className="home">
      {/* Header */}
      <div className="header">
        <h1>Interview Prep</h1>
        <p>AI-powered conceptual & scenario-based questions</p>
      </div>

      {/* Input Section */}
      <div className="input-section">
        <div className="input-header">
          <label>Job Description</label>
        </div>
        <textarea
          className="textarea"
          data-testid="job-description-input"
          placeholder="Paste job description here...\n\nInclude:\n• Company name\n• Job title & level\n• Required skills & technologies\n• Responsibilities"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          rows={6}
        />
        <button 
          className="generate-btn" 
          data-testid="generate-questions-btn"
          onClick={generateQuestionsStream}
          disabled={loading}
        >
          {loading ? (
            <><Loader2 className="spin" size={20} /> {streamStatus || 'Generating...'}</>
          ) : (
            <><Zap size={20} /> Generate Questions (Streaming)</>
          )}
        </button>
      </div>

      {/* Streaming Status */}
      {isStreaming && streamStatus && (
        <div className="stream-status">
          <Loader2 className="spin" size={20} />
          <span>{streamStatus}</span>
        </div>
      )}

      {/* Job Analysis */}
      {jobAnalysis && (
        <div className="analysis-card" data-testid="job-analysis-card">
          <div className="analysis-header">
            <BookOpen size={20} />
            <span>Detected: {jobAnalysis.job_title}</span>
          </div>
          <div className="analysis-chips">
            {jobAnalysis.company_name && <span className="chip">{jobAnalysis.company_name}</span>}
            <span className="chip">{jobAnalysis.seniority_level}</span>
            <span className="chip">{jobAnalysis.domain}</span>
          </div>
          {jobAnalysis.technical_skills?.length > 0 && (
            <div className="skills-row">
              {jobAnalysis.technical_skills.slice(0, 8).map((skill, i) => (
                <span key={i} className="skill-chip">{skill}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Questions Section */}
      {questions && (questions.technical.length > 0 || questions.behavioral.length > 0 || questions.situational.length > 0 || questions.company_specific.length > 0) && (
        <div className="questions-section" data-testid="questions-section">
          {/* Category Tabs */}
          <div className="tabs">
            {categories.map(cat => {
              const count = (questions[cat.key] || []).length
              const active = selectedCategory === cat.key
              const Icon = cat.icon
              return (
                <button
                  key={cat.key}
                  className={`tab ${active ? 'active' : ''}`}
                  data-testid={`tab-${cat.key}`}
                  style={active ? { backgroundColor: cat.color, borderColor: cat.color } : {}}
                  onClick={() => setSelectedCategory(cat.key)}
                >
                  <Icon size={18} />
                  <span>{cat.label}</span>
                  <span className="tab-count">{count}</span>
                </button>
              )
            })}
          </div>

          {/* Questions List */}
          {currentQuestions.length === 0 ? (
            <div className="empty">
              {isStreaming ? (
                <>
                  <Loader2 className="spin" size={48} />
                  <p>Waiting for {selectedCategory} questions...</p>
                </>
              ) : (
                <>
                  <Search size={48} />
                  <p>No questions found in this category</p>
                </>
              )}
            </div>
          ) : (
            <div className="questions-list">
              {currentQuestions.map((q, i) => (
                <div key={q.id} className="question-card" data-testid={`question-card-${i}`}>
                  <div className="question-header">
                    <span className="question-num">{i + 1}</span>
                    <div className="question-meta">
                      {q.skill_tag && <span className="skill-badge">{q.skill_tag}</span>}
                      {q.difficulty && (
                        <span className="diff-badge" style={{ backgroundColor: getDifficultyColor(q.difficulty) + '20', color: getDifficultyColor(q.difficulty) }}>
                          {q.difficulty}
                        </span>
                      )}
                      {q.source === 'web_search' && (
                        <a href={q.source_url} target="_blank" rel="noopener noreferrer" className="source-link">
                          <ExternalLink size={12} /> Source
                        </a>
                      )}
                    </div>
                    <button 
                      className="fav-btn"
                      data-testid={`fav-btn-${i}`}
                      onClick={() => saveToFavorites(q)}
                      disabled={savingIds.has(q.id)}
                    >
                      {savingIds.has(q.id) ? <Loader2 className="spin" size={18} /> : <Heart size={18} />}
                    </button>
                  </div>
                  <p className="question-text">{q.question}</p>
                  <button className="view-answer-btn" data-testid={`view-answer-btn-${i}`} onClick={() => openModal(q)}>
                    <Eye size={18} />
                    View Answer
                    <ChevronRight size={18} />
                  </button>
                </div>
              ))}

              {/* Load More */}
              {!isStreaming && (
                <button 
                  className="load-more-btn"
                  data-testid="load-more-btn"
                  onClick={loadMoreQuestions}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Loader2 className="spin" size={20} /> : <Plus size={20} />}
                  Load More Questions
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Answer Modal */}
      {modalOpen && selectedQuestion && (
        <div className="modal-overlay" data-testid="answer-modal" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close-btn" data-testid="close-modal-btn" onClick={() => setModalOpen(false)}>
              <X size={24} />
            </button>
            
            <div className="modal-badges">
              {selectedQuestion.skill_tag && (
                <span className="modal-skill">{selectedQuestion.skill_tag}</span>
              )}
              {selectedQuestion.difficulty && (
                <span className="modal-diff" style={{ backgroundColor: getDifficultyColor(selectedQuestion.difficulty) }}>
                  {selectedQuestion.difficulty}
                </span>
              )}
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
            
            <button 
              className="modal-save-btn"
              data-testid="modal-save-btn"
              onClick={() => { saveToFavorites(selectedQuestion); setModalOpen(false); }}
            >
              <Heart size={20} />
              Save to Favorites
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
