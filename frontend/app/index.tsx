import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  Linking,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Question {
  id: string;
  question: string;
  answer: string;
  category: string;
  job_description: string;
  source?: string;
  source_url?: string;
  company?: string;
  skill_tag?: string;
  difficulty?: string;
}

interface JobAnalysis {
  company_name: string | null;
  job_title: string;
  industry: string;
  seniority_level: string;
  key_skills: string[];
  technical_skills: string[];
  soft_skills: string[];
  job_type: string;
  domain: string;
}

interface QuestionsResponse {
  technical: Question[];
  behavioral: Question[];
  situational: Question[];
  company_specific: Question[];
  job_analysis: JobAnalysis | null;
}

export default function HomeScreen() {
  const [jobDescription, setJobDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [questions, setQuestions] = useState<QuestionsResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('technical');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  
  // Flashcard modal state
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [flashcardVisible, setFlashcardVisible] = useState(false);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.[0]) {
        setUploadModalVisible(false);
        await extractTextFromFile(result.assets[0].uri, 'pdf');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Please grant access');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
      if (!result.canceled && result.assets?.[0]?.base64) {
        setUploadModalVisible(false);
        await extractTextFromBase64(result.assets[0].base64);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Please grant camera access');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true });
      if (!result.canceled && result.assets?.[0]?.base64) {
        setUploadModalVisible(false);
        await extractTextFromBase64(result.assets[0].base64);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const extractTextFromBase64 = async (base64: string) => {
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append('image_base64', base64);
      const response = await axios.post(`${API_URL}/api/extract-text-base64`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (response.data.extracted_text) {
        setJobDescription(response.data.extracted_text);
        Alert.alert('Success', 'Text extracted!');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    } finally {
      setExtracting(false);
    }
  };

  const extractTextFromFile = async (uri: string, type: string) => {
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append('file', { uri, name: type === 'pdf' ? 'doc.pdf' : 'img.jpg', type: type === 'pdf' ? 'application/pdf' : 'image/jpeg' } as any);
      const response = await axios.post(`${API_URL}/api/extract-text`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (response.data.extracted_text) {
        setJobDescription(response.data.extracted_text);
        Alert.alert('Success', 'Text extracted!');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    } finally {
      setExtracting(false);
    }
  };

  const generateQuestions = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('Error', 'Please enter a job description');
      return;
    }
    setLoading(true);
    setQuestions(null);
    try {
      const response = await axios.post(`${API_URL}/api/generate-questions`, { job_description: jobDescription });
      setQuestions(response.data);
      setSelectedCategory('technical');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreQuestions = async () => {
    if (!questions?.job_analysis) return;
    setLoadingMore(true);
    try {
      const currentQuestions = (questions[selectedCategory as keyof QuestionsResponse] as Question[]) || [];
      const response = await axios.post(`${API_URL}/api/load-more`, {
        job_description: jobDescription,
        category: selectedCategory,
        existing_questions: currentQuestions.map(q => q.question),
        skills: questions.job_analysis.technical_skills || [],
        domain: questions.job_analysis.domain,
        job_title: questions.job_analysis.job_title,
        seniority: questions.job_analysis.seniority_level,
      });
      if (response.data.questions?.length > 0) {
        setQuestions(prev => {
          if (!prev) return prev;
          const current = (prev[selectedCategory as keyof QuestionsResponse] as Question[]) || [];
          return { ...prev, [selectedCategory]: [...current, ...response.data.questions] };
        });
      } else {
        Alert.alert('Info', 'No more unique questions');
      }
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  const openFlashcard = (question: Question) => {
    setSelectedQuestion(question);
    setFlashcardVisible(true);
  };

  const saveToFavorites = async (question: Question) => {
    setSavingIds(prev => new Set(prev).add(question.id));
    try {
      await axios.post(`${API_URL}/api/favorites`, {
        question: question.question,
        answer: question.answer,
        category: question.category,
        job_description: question.job_description,
        source: question.source,
        source_url: question.source_url,
        company: question.company,
        skill_tag: question.skill_tag,
      });
      Alert.alert('Success', 'Saved!');
    } catch {
      Alert.alert('Error', 'Failed to save');
    } finally {
      setSavingIds(prev => { const s = new Set(prev); s.delete(question.id); return s; });
    }
  };

  const openSourceLink = (url?: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      Linking.openURL(url);
    }
  };

  const categories = [
    { key: 'technical', label: 'Technical', icon: 'code-slash', color: '#6c63ff' },
    { key: 'company_specific', label: 'Company', icon: 'business', color: '#4CAF50' },
    { key: 'behavioral', label: 'Behavioral', icon: 'people', color: '#FF9800' },
    { key: 'situational', label: 'Situational', icon: 'bulb', color: '#2196F3' },
  ];

  const currentQuestions = questions ? (questions[selectedCategory as keyof QuestionsResponse] as Question[]) || [] : [];
  const jobAnalysis = questions?.job_analysis;

  const getDifficultyColor = (d?: string) => ({ easy: '#4CAF50', medium: '#FF9800', hard: '#f44336' }[d || ''] || '#888');

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Interview Prep</Text>
            <Text style={styles.subtitle}>Conceptual & scenario-based questions</Text>
          </View>

          {/* Input Section */}
          <View style={styles.inputSection}>
            <View style={styles.inputHeader}>
              <Text style={styles.inputLabel}>Job Description</Text>
              <TouchableOpacity style={styles.uploadBtn} onPress={() => setUploadModalVisible(true)} disabled={extracting}>
                {extracting ? <ActivityIndicator size="small" color="#6c63ff" /> : (
                  <><Ionicons name="cloud-upload" size={18} color="#6c63ff" /><Text style={styles.uploadText}>Upload</Text></>
                )}
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              placeholder="Paste job description here..."
              placeholderTextColor="#555"
              multiline
              value={jobDescription}
              onChangeText={setJobDescription}
              textAlignVertical="top"
            />
            <TouchableOpacity style={[styles.generateBtn, loading && styles.disabled]} onPress={generateQuestions} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <><Ionicons name="search" size={20} color="#fff" /><Text style={styles.generateText}>Generate Questions</Text></>
              )}
            </TouchableOpacity>
          </View>

          {/* Loading */}
          {loading && (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#6c63ff" />
              <Text style={styles.loadingText}>Analyzing & searching...</Text>
              <Text style={styles.loadingSub}>Running parallel searches</Text>
            </View>
          )}

          {/* Job Analysis */}
          {jobAnalysis && !loading && (
            <View style={styles.analysisCard}>
              <View style={styles.analysisRow}>
                <Ionicons name="analytics" size={18} color="#6c63ff" />
                <Text style={styles.analysisTitle}>Detected: {jobAnalysis.job_title}</Text>
              </View>
              <View style={styles.chipRow}>
                {jobAnalysis.company_name && <View style={styles.chip}><Text style={styles.chipText}>{jobAnalysis.company_name}</Text></View>}
                <View style={styles.chip}><Text style={styles.chipText}>{jobAnalysis.seniority_level}</Text></View>
                <View style={styles.chip}><Text style={styles.chipText}>{jobAnalysis.domain}</Text></View>
              </View>
              {jobAnalysis.technical_skills.length > 0 && (
                <View style={styles.skillsRow}>
                  {jobAnalysis.technical_skills.slice(0, 6).map((s, i) => (
                    <View key={i} style={styles.skillChip}><Text style={styles.skillText}>{s}</Text></View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Questions */}
          {questions && !loading && (
            <View style={styles.questionsSection}>
              {/* Category Tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
                <View style={styles.tabRow}>
                  {categories.map(cat => {
                    const list = questions[cat.key as keyof QuestionsResponse] as Question[] | undefined;
                    const count = Array.isArray(list) ? list.length : 0;
                    const active = selectedCategory === cat.key;
                    return (
                      <TouchableOpacity
                        key={cat.key}
                        style={[styles.tab, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                        onPress={() => setSelectedCategory(cat.key)}
                      >
                        <Ionicons name={cat.icon as any} size={16} color={active ? '#fff' : '#888'} />
                        <Text style={[styles.tabText, active && styles.tabTextActive]}>{cat.label}</Text>
                        <View style={[styles.badge, active && styles.badgeActive]}>
                          <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{count}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Questions List */}
              {currentQuestions.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="search" size={48} color="#444" />
                  <Text style={styles.emptyText}>No questions found</Text>
                </View>
              ) : (
                <View style={styles.questionList}>
                  {currentQuestions.map((q, i) => (
                    <View key={q.id} style={styles.qCard}>
                      <View style={styles.qHeader}>
                        <View style={styles.qNum}><Text style={styles.qNumText}>{i + 1}</Text></View>
                        <View style={styles.qMeta}>
                          {q.skill_tag && <View style={styles.skillBadge}><Text style={styles.skillBadgeText}>{q.skill_tag}</Text></View>}
                          {q.difficulty && (
                            <View style={[styles.diffBadge, { backgroundColor: getDifficultyColor(q.difficulty) + '20' }]}>
                              <Text style={[styles.diffText, { color: getDifficultyColor(q.difficulty) }]}>{q.difficulty}</Text>
                            </View>
                          )}
                          {q.source === 'web_search' && (
                            <TouchableOpacity style={styles.webBadge} onPress={() => openSourceLink(q.source_url)}>
                              <Ionicons name="globe" size={10} color="#4CAF50" />
                              <Text style={styles.webText}>Source</Text>
                              <Ionicons name="open-outline" size={10} color="#4CAF50" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <TouchableOpacity style={styles.favBtn} onPress={() => saveToFavorites(q)} disabled={savingIds.has(q.id)}>
                          {savingIds.has(q.id) ? <ActivityIndicator size="small" color="#6c63ff" /> : <Ionicons name="heart-outline" size={22} color="#6c63ff" />}
                        </TouchableOpacity>
                      </View>
                      
                      <Text style={styles.qText}>{q.question}</Text>
                      
                      <TouchableOpacity style={styles.answerBtn} onPress={() => openFlashcard(q)}>
                        <Ionicons name="eye" size={18} color="#6c63ff" />
                        <Text style={styles.answerBtnText}>View Answer</Text>
                        <Ionicons name="chevron-forward" size={18} color="#6c63ff" />
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* Load More */}
                  <TouchableOpacity style={[styles.loadMoreBtn, loadingMore && styles.disabled]} onPress={loadMoreQuestions} disabled={loadingMore}>
                    {loadingMore ? <ActivityIndicator color="#6c63ff" /> : (
                      <><Ionicons name="add-circle-outline" size={20} color="#6c63ff" /><Text style={styles.loadMoreText}>Load More Questions</Text></>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Upload Modal */}
      <Modal visible={uploadModalVisible} transparent animationType="slide" onRequestClose={() => setUploadModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setUploadModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Upload Job Description</Text>
            {[
              { icon: 'document-text', color: '#FF5733', title: 'PDF', desc: 'Select document', action: pickDocument },
              { icon: 'image', color: '#4CAF50', title: 'Image', desc: 'From gallery', action: pickImage },
              { icon: 'camera', color: '#2196F3', title: 'Camera', desc: 'Take photo', action: takePhoto },
            ].map((opt, i) => (
              <TouchableOpacity key={i} style={styles.modalOpt} onPress={opt.action}>
                <View style={[styles.modalIcon, { backgroundColor: opt.color + '20' }]}><Ionicons name={opt.icon as any} size={24} color={opt.color} /></View>
                <View style={styles.modalOptText}><Text style={styles.modalOptTitle}>{opt.title}</Text><Text style={styles.modalOptDesc}>{opt.desc}</Text></View>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setUploadModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Flashcard Answer Modal */}
      <Modal visible={flashcardVisible} transparent animationType="fade" onRequestClose={() => setFlashcardVisible(false)}>
        <View style={styles.flashcardOverlay}>
          <View style={styles.flashcard}>
            {/* Close Button */}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setFlashcardVisible(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>

            <ScrollView style={styles.flashcardScroll} showsVerticalScrollIndicator={false}>
              {selectedQuestion && (
                <>
                  {/* Question */}
                  <View style={styles.flashcardHeader}>
                    <View style={styles.flashcardBadges}>
                      {selectedQuestion.skill_tag && (
                        <View style={styles.flashSkillBadge}>
                          <Text style={styles.flashSkillText}>{selectedQuestion.skill_tag}</Text>
                        </View>
                      )}
                      {selectedQuestion.difficulty && (
                        <View style={[styles.flashDiffBadge, { backgroundColor: getDifficultyColor(selectedQuestion.difficulty) }]}>
                          <Text style={styles.flashDiffText}>{selectedQuestion.difficulty}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.flashcardLabel}>QUESTION</Text>
                    <Text style={styles.flashcardQuestion}>{selectedQuestion.question}</Text>
                  </View>

                  {/* Divider */}
                  <View style={styles.divider} />

                  {/* Answer */}
                  <View style={styles.flashcardBody}>
                    <Text style={styles.flashcardLabel}>ANSWER</Text>
                    <Text style={styles.flashcardAnswer}>{selectedQuestion.answer}</Text>
                  </View>

                  {/* Source Link */}
                  {selectedQuestion.source === 'web_search' && selectedQuestion.source_url && (
                    <TouchableOpacity style={styles.sourceLink} onPress={() => openSourceLink(selectedQuestion.source_url)}>
                      <Ionicons name="link" size={16} color="#4CAF50" />
                      <Text style={styles.sourceLinkText}>View Source</Text>
                      <Ionicons name="open-outline" size={14} color="#4CAF50" />
                    </TouchableOpacity>
                  )}

                  {/* Actions */}
                  <View style={styles.flashcardActions}>
                    <TouchableOpacity 
                      style={styles.flashcardSaveBtn} 
                      onPress={() => { saveToFavorites(selectedQuestion); setFlashcardVisible(false); }}
                    >
                      <Ionicons name="heart" size={20} color="#fff" />
                      <Text style={styles.flashcardSaveText}>Save to Favorites</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  flex: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  
  header: { marginBottom: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#888' },
  
  inputSection: { marginBottom: 20 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  inputLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, paddingHorizontal: 12, backgroundColor: 'rgba(108,99,255,0.15)', borderRadius: 8 },
  uploadText: { color: '#6c63ff', fontSize: 14, fontWeight: '600' },
  textInput: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, fontSize: 15, color: '#fff', minHeight: 120, borderWidth: 1, borderColor: '#2d2d44', marginBottom: 16 },
  generateBtn: { backgroundColor: '#6c63ff', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  generateText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.6 },
  
  loadingBox: { alignItems: 'center', padding: 40 },
  loadingText: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16 },
  loadingSub: { color: '#4CAF50', fontSize: 14, marginTop: 8 },
  
  analysisCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#2d2d44' },
  analysisRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  analysisTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: '#0f0f1a', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20 },
  chipText: { fontSize: 12, color: '#888', textTransform: 'capitalize' },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: { backgroundColor: 'rgba(108,99,255,0.15)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  skillText: { fontSize: 12, color: '#6c63ff', fontWeight: '500' },
  
  questionsSection: { marginTop: 8 },
  tabScroll: { marginBottom: 16 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#1a1a2e', borderRadius: 10, borderWidth: 1, borderColor: '#2d2d44' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#888' },
  tabTextActive: { color: '#fff' },
  badge: { backgroundColor: '#2d2d44', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 4 },
  badgeActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#888' },
  badgeTextActive: { color: '#fff' },
  
  emptyBox: { alignItems: 'center', padding: 40 },
  emptyText: { color: '#666', fontSize: 14, marginTop: 16 },
  
  questionList: { gap: 16 },
  qCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2d2d44' },
  qHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  qNum: { width: 32, height: 32, backgroundColor: '#6c63ff', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qNumText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  qMeta: { flex: 1, marginLeft: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skillBadge: { backgroundColor: 'rgba(108,99,255,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  skillBadgeText: { fontSize: 11, color: '#6c63ff', fontWeight: '600' },
  diffBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  diffText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  webBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(76,175,80,0.15)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  webText: { fontSize: 10, color: '#4CAF50', fontWeight: '600' },
  favBtn: { padding: 8 },
  qText: { fontSize: 16, fontWeight: '600', color: '#fff', lineHeight: 24, marginBottom: 16 },
  
  answerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: 'rgba(108,99,255,0.15)', borderRadius: 10 },
  answerBtnText: { color: '#6c63ff', fontSize: 15, fontWeight: '600' },
  
  loadMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, backgroundColor: '#1a1a2e', borderRadius: 12, borderWidth: 1, borderColor: '#6c63ff', borderStyle: 'dashed', marginTop: 8 },
  loadMoreText: { color: '#6c63ff', fontSize: 15, fontWeight: '600' },
  
  // Upload Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  modalOpt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#2d2d44' },
  modalIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalOptText: { flex: 1, marginLeft: 16 },
  modalOptTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  modalOptDesc: { fontSize: 13, color: '#888', marginTop: 2 },
  modalCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  cancelText: { fontSize: 16, fontWeight: '600', color: '#ff4757' },
  
  // Flashcard Modal
  flashcardOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  flashcard: { width: '100%', maxHeight: SCREEN_HEIGHT * 0.85, backgroundColor: '#1a1a2e', borderRadius: 24, overflow: 'hidden' },
  closeBtn: { position: 'absolute', top: 16, right: 16, zIndex: 10, width: 44, height: 44, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flashcardScroll: { padding: 24, paddingTop: 60 },
  flashcardHeader: { marginBottom: 24 },
  flashcardBadges: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  flashSkillBadge: { backgroundColor: 'rgba(108,99,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  flashSkillText: { fontSize: 13, color: '#6c63ff', fontWeight: '600' },
  flashDiffBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  flashDiffText: { fontSize: 13, color: '#fff', fontWeight: '600', textTransform: 'capitalize' },
  flashcardLabel: { fontSize: 12, fontWeight: '700', color: '#6c63ff', letterSpacing: 1, marginBottom: 12 },
  flashcardQuestion: { fontSize: 20, fontWeight: '600', color: '#fff', lineHeight: 30 },
  divider: { height: 1, backgroundColor: '#2d2d44', marginVertical: 24 },
  flashcardBody: { marginBottom: 24 },
  flashcardAnswer: { fontSize: 16, color: '#ccc', lineHeight: 26 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(76,175,80,0.1)', padding: 12, borderRadius: 10, marginBottom: 24 },
  sourceLinkText: { color: '#4CAF50', fontSize: 14, fontWeight: '500', flex: 1 },
  flashcardActions: { paddingBottom: 20 },
  flashcardSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#6c63ff', paddingVertical: 16, borderRadius: 12 },
  flashcardSaveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
