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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Question {
  id: string;
  question: string;
  answer: string;
  category: string;
  job_description: string;
  source?: string;
  source_url?: string;
  company?: string;
}

interface JobAnalysis {
  company_name: string | null;
  job_title: string;
  industry: string;
  seniority_level: string;
  key_skills: string[];
  job_type: string;
  search_terms: string[];
}

interface QuestionsResponse {
  technical: Question[];
  behavioral: Question[];
  situational: Question[];
  web_sourced: Question[];
  job_analysis: JobAnalysis | null;
}

export default function HomeScreen() {
  const [jobDescription, setJobDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [questions, setQuestions] = useState<QuestionsResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('web_sourced');
  const [practiceMode, setPracticeMode] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [uploadModalVisible, setUploadModalVisible] = useState(false);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setUploadModalVisible(false);
        await extractTextFromFile(result.assets[0].uri, 'pdf');
      }
    } catch (error) {
      console.error('Document picker error:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const pickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Please grant camera roll access to upload images');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setUploadModalVisible(false);
        const asset = result.assets[0];
        if (asset.base64) {
          await extractTextFromBase64(asset.base64);
        } else if (asset.uri) {
          await extractTextFromFile(asset.uri, 'image');
        }
      }
    } catch (error) {
      console.error('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const takePhoto = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Please grant camera access to take photos');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setUploadModalVisible(false);
        const asset = result.assets[0];
        if (asset.base64) {
          await extractTextFromBase64(asset.base64);
        }
      }
    } catch (error) {
      console.error('Camera error:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const extractTextFromBase64 = async (base64: string) => {
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append('image_base64', base64);

      const response = await axios.post(`${API_URL}/api/extract-text-base64`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data.extracted_text) {
        setJobDescription(response.data.extracted_text);
        Alert.alert('Success', 'Text extracted from image!');
      }
    } catch (error: any) {
      console.error('Text extraction error:', error);
      Alert.alert('Error', error.response?.data?.detail || 'Failed to extract text');
    } finally {
      setExtracting(false);
    }
  };

  const extractTextFromFile = async (uri: string, type: 'pdf' | 'image') => {
    setExtracting(true);
    try {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('File not found');
      }

      const formData = new FormData();
      const filename = type === 'pdf' ? 'document.pdf' : 'image.jpg';
      const mimeType = type === 'pdf' ? 'application/pdf' : 'image/jpeg';

      formData.append('file', {
        uri: uri,
        name: filename,
        type: mimeType,
      } as any);

      const response = await axios.post(`${API_URL}/api/extract-text`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data.extracted_text) {
        setJobDescription(response.data.extracted_text);
        Alert.alert('Success', `Text extracted from ${type}!`);
      }
    } catch (error: any) {
      console.error('File extraction error:', error);
      Alert.alert('Error', error.response?.data?.detail || 'Failed to extract text');
    } finally {
      setExtracting(false);
    }
  };

  const generateQuestions = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('Error', 'Please enter a job description or upload a file');
      return;
    }

    setLoading(true);
    setQuestions(null);
    setRevealedAnswers(new Set());

    try {
      const response = await axios.post(`${API_URL}/api/generate-questions`, {
        job_description: jobDescription,
      });
      setQuestions(response.data);
      
      // Default to web_sourced if available, otherwise technical
      if (response.data.web_sourced && response.data.web_sourced.length > 0) {
        setSelectedCategory('web_sourced');
      } else {
        setSelectedCategory('technical');
      }
    } catch (error: any) {
      console.error('Error generating questions:', error);
      Alert.alert('Error', error.response?.data?.detail || 'Failed to generate questions');
    } finally {
      setLoading(false);
    }
  };

  const toggleAnswer = (questionId: string) => {
    setRevealedAnswers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };

  const saveToFavorites = async (question: Question) => {
    setSavingIds((prev) => new Set(prev).add(question.id));
    try {
      await axios.post(`${API_URL}/api/favorites`, {
        question: question.question,
        answer: question.answer,
        category: question.category,
        job_description: question.job_description,
        source: question.source,
        source_url: question.source_url,
        company: question.company,
      });
      Alert.alert('Success', 'Question saved to favorites!');
    } catch (error: any) {
      console.error('Error saving favorite:', error);
      Alert.alert('Error', 'Failed to save to favorites');
    } finally {
      setSavingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(question.id);
        return newSet;
      });
    }
  };

  const categories = [
    { key: 'web_sourced', label: 'Real Questions', icon: 'globe', color: '#4CAF50' },
    { key: 'technical', label: 'Technical', icon: 'code-slash', color: '#6c63ff' },
    { key: 'behavioral', label: 'Behavioral', icon: 'people', color: '#FF9800' },
    { key: 'situational', label: 'Situational', icon: 'bulb', color: '#2196F3' },
  ];

  const currentQuestions = questions ? questions[selectedCategory as keyof QuestionsResponse] || [] : [];
  const jobAnalysis = questions?.job_analysis;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Interview Prep</Text>
            <Text style={styles.subtitle}>AI analyzes your job description automatically</Text>
          </View>

          {/* Job Description Input */}
          <View style={styles.inputSection}>
            <View style={styles.inputHeader}>
              <Text style={styles.inputLabel}>Job Description</Text>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={() => setUploadModalVisible(true)}
                disabled={extracting}
              >
                {extracting ? (
                  <ActivityIndicator size="small" color="#6c63ff" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={18} color="#6c63ff" />
                    <Text style={styles.uploadButtonText}>Upload</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              placeholder="Paste job description here or upload a PDF/image...

Example: 'Software Engineer at Google - looking for candidates with 3+ years React experience...'"
              placeholderTextColor="#555"
              multiline
              numberOfLines={6}
              value={jobDescription}
              onChangeText={setJobDescription}
              textAlignVertical="top"
            />
            <Text style={styles.inputHint}>
              <Ionicons name="sparkles" size={14} color="#6c63ff" /> AI will automatically detect company, role, skills & find relevant questions
            </Text>
            <TouchableOpacity
              style={[styles.generateButton, loading && styles.generateButtonDisabled]}
              onPress={generateQuestions}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="search" size={20} color="#fff" />
                  <Text style={styles.generateButtonText}>Analyze & Generate Questions</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Loading State */}
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6c63ff" />
              <Text style={styles.loadingText}>Analyzing job description...</Text>
              <Text style={styles.loadingSubtext}>Extracting company, role & searching for questions</Text>
            </View>
          )}

          {/* Job Analysis Card */}
          {jobAnalysis && !loading && (
            <View style={styles.analysisCard}>
              <View style={styles.analysisHeader}>
                <Ionicons name="analytics" size={20} color="#6c63ff" />
                <Text style={styles.analysisTitle}>Detected Information</Text>
              </View>
              <View style={styles.analysisGrid}>
                {jobAnalysis.company_name && (
                  <View style={styles.analysisItem}>
                    <Ionicons name="business" size={16} color="#4CAF50" />
                    <Text style={styles.analysisLabel}>Company</Text>
                    <Text style={styles.analysisValue}>{jobAnalysis.company_name}</Text>
                  </View>
                )}
                <View style={styles.analysisItem}>
                  <Ionicons name="briefcase" size={16} color="#2196F3" />
                  <Text style={styles.analysisLabel}>Role</Text>
                  <Text style={styles.analysisValue}>{jobAnalysis.job_title}</Text>
                </View>
                <View style={styles.analysisItem}>
                  <Ionicons name="trending-up" size={16} color="#FF9800" />
                  <Text style={styles.analysisLabel}>Level</Text>
                  <Text style={styles.analysisValue}>{jobAnalysis.seniority_level}</Text>
                </View>
                <View style={styles.analysisItem}>
                  <Ionicons name="layers" size={16} color="#9C27B0" />
                  <Text style={styles.analysisLabel}>Industry</Text>
                  <Text style={styles.analysisValue}>{jobAnalysis.industry}</Text>
                </View>
              </View>
              {jobAnalysis.key_skills && jobAnalysis.key_skills.length > 0 && (
                <View style={styles.skillsContainer}>
                  <Text style={styles.skillsLabel}>Key Skills:</Text>
                  <View style={styles.skillsTags}>
                    {jobAnalysis.key_skills.slice(0, 5).map((skill, index) => (
                      <View key={index} style={styles.skillTag}>
                        <Text style={styles.skillText}>{skill}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Questions Section */}
          {questions && !loading && (
            <View style={styles.questionsSection}>
              {/* Practice Mode Toggle */}
              <View style={styles.practiceModeContainer}>
                <View style={styles.practiceModeInfo}>
                  <Ionicons name="eye-off" size={20} color="#6c63ff" />
                  <Text style={styles.practiceModeText}>Practice Mode</Text>
                </View>
                <TouchableOpacity
                  style={[styles.practiceToggle, practiceMode && styles.practiceToggleActive]}
                  onPress={() => {
                    setPracticeMode(!practiceMode);
                    setRevealedAnswers(new Set());
                  }}
                >
                  <View
                    style={[
                      styles.toggleKnob,
                      practiceMode && styles.toggleKnobActive,
                    ]}
                  />
                </TouchableOpacity>
              </View>

              {/* Category Tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
                <View style={styles.categoryTabs}>
                  {categories.map((cat) => {
                    const questionList = questions[cat.key as keyof QuestionsResponse];
                    const count = Array.isArray(questionList) ? questionList.length : 0;
                    return (
                      <TouchableOpacity
                        key={cat.key}
                        style={[
                          styles.categoryTab,
                          selectedCategory === cat.key && { backgroundColor: cat.color, borderColor: cat.color },
                        ]}
                        onPress={() => setSelectedCategory(cat.key)}
                      >
                        <Ionicons
                          name={cat.icon as any}
                          size={16}
                          color={selectedCategory === cat.key ? '#fff' : '#888'}
                        />
                        <Text
                          style={[
                            styles.categoryTabText,
                            selectedCategory === cat.key && styles.categoryTabTextActive,
                          ]}
                        >
                          {cat.label}
                        </Text>
                        <View style={[
                          styles.countBadge,
                          selectedCategory === cat.key && styles.countBadgeActive
                        ]}>
                          <Text style={[
                            styles.countText,
                            selectedCategory === cat.key && styles.countTextActive
                          ]}>{count}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Source Info for Web Questions */}
              {selectedCategory === 'web_sourced' && Array.isArray(currentQuestions) && currentQuestions.length > 0 && (
                <View style={styles.sourceInfo}>
                  <Ionicons name="information-circle" size={16} color="#FF9800" />
                  <Text style={styles.sourceInfoText}>
                    Questions based on Gemini AI's knowledge of interview patterns
                  </Text>
                </View>
              )}

              {/* Questions List */}
              {!Array.isArray(currentQuestions) || currentQuestions.length === 0 ? (
                <View style={styles.emptyCategory}>
                  <Ionicons name="search" size={48} color="#444" />
                  <Text style={styles.emptyCategoryText}>
                    {selectedCategory === 'web_sourced'
                      ? 'No specific questions found for this role.'
                      : 'No questions in this category.'}
                  </Text>
                </View>
              ) : (
                <View style={styles.questionsList}>
                  {currentQuestions.map((q: Question, index: number) => (
                    <View key={q.id} style={styles.questionCard}>
                      <View style={styles.questionHeader}>
                        <View style={styles.questionNumber}>
                          <Text style={styles.questionNumberText}>{index + 1}</Text>
                        </View>
                        <View style={styles.questionMeta}>
                          {q.source === 'web_search' && q.source_url && (
                            <View style={styles.sourceBadge}>
                              <Ionicons name="globe" size={12} color="#4CAF50" />
                              <Text style={styles.sourceText}>{q.source_url}</Text>
                            </View>
                          )}
                        </View>
                        <TouchableOpacity
                          style={styles.favoriteButton}
                          onPress={() => saveToFavorites(q)}
                          disabled={savingIds.has(q.id)}
                        >
                          {savingIds.has(q.id) ? (
                            <ActivityIndicator size="small" color="#6c63ff" />
                          ) : (
                            <Ionicons name="heart-outline" size={22} color="#6c63ff" />
                          )}
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.questionText}>{q.question}</Text>

                      {practiceMode ? (
                        <TouchableOpacity
                          style={styles.revealButton}
                          onPress={() => toggleAnswer(q.id)}
                        >
                          <Ionicons
                            name={revealedAnswers.has(q.id) ? 'eye' : 'eye-off'}
                            size={18}
                            color="#6c63ff"
                          />
                          <Text style={styles.revealButtonText}>
                            {revealedAnswers.has(q.id) ? 'Hide Answer' : 'Show Answer'}
                          </Text>
                        </TouchableOpacity>
                      ) : null}

                      {(!practiceMode || revealedAnswers.has(q.id)) && (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerLabel}>
                            {q.source === 'web_search' ? 'Suggested Approach:' : 'Sample Answer:'}
                          </Text>
                          <Text style={styles.answerText}>{q.answer}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Upload Modal */}
      <Modal
        visible={uploadModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setUploadModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setUploadModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Upload Job Description</Text>
            <Text style={styles.modalSubtitle}>Extract text from PDF or image</Text>

            <TouchableOpacity style={styles.modalOption} onPress={pickDocument}>
              <View style={[styles.modalIconContainer, { backgroundColor: '#FF573320' }]}>
                <Ionicons name="document-text" size={24} color="#FF5733" />
              </View>
              <View style={styles.modalOptionText}>
                <Text style={styles.modalOptionTitle}>Upload PDF</Text>
                <Text style={styles.modalOptionDesc}>Select a PDF document</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={pickImage}>
              <View style={[styles.modalIconContainer, { backgroundColor: '#4CAF5020' }]}>
                <Ionicons name="image" size={24} color="#4CAF50" />
              </View>
              <View style={styles.modalOptionText}>
                <Text style={styles.modalOptionTitle}>Choose Image</Text>
                <Text style={styles.modalOptionDesc}>Select from gallery</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={takePhoto}>
              <View style={[styles.modalIconContainer, { backgroundColor: '#2196F320' }]}>
                <Ionicons name="camera" size={24} color="#2196F3" />
              </View>
              <View style={styles.modalOptionText}>
                <Text style={styles.modalOptionTitle}>Take Photo</Text>
                <Text style={styles.modalOptionDesc}>Capture job posting</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setUploadModalVisible(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#888',
  },
  inputSection: {
    marginBottom: 20,
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  inputHint: {
    fontSize: 13,
    color: '#888',
    marginTop: 10,
    marginBottom: 16,
    lineHeight: 18,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    borderRadius: 8,
  },
  uploadButtonText: {
    color: '#6c63ff',
    fontSize: 14,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#fff',
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  generateButton: {
    backgroundColor: '#6c63ff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateButtonDisabled: {
    opacity: 0.7,
  },
  generateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  loadingSubtext: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  // Analysis Card
  analysisCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  analysisTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  analysisGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  analysisItem: {
    width: '47%',
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  analysisLabel: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  analysisValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  skillsContainer: {
    marginTop: 16,
  },
  skillsLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
  },
  skillsTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillTag: {
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  skillText: {
    fontSize: 13,
    color: '#6c63ff',
    fontWeight: '500',
  },
  questionsSection: {
    marginTop: 8,
  },
  practiceModeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  practiceModeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  practiceModeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  practiceToggle: {
    width: 50,
    height: 28,
    backgroundColor: '#2d2d44',
    borderRadius: 14,
    padding: 2,
  },
  practiceToggleActive: {
    backgroundColor: '#6c63ff',
  },
  toggleKnob: {
    width: 24,
    height: 24,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  toggleKnobActive: {
    transform: [{ translateX: 22 }],
  },
  categoryScroll: {
    marginBottom: 16,
  },
  categoryTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  categoryTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  categoryTabTextActive: {
    color: '#fff',
  },
  countBadge: {
    backgroundColor: '#2d2d44',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  countBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  countTextActive: {
    color: '#fff',
  },
  sourceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  sourceInfoText: {
    color: '#FF9800',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  emptyCategory: {
    alignItems: 'center',
    padding: 40,
  },
  emptyCategoryText: {
    color: '#666',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  questionsList: {
    gap: 16,
  },
  questionCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  questionNumber: {
    width: 32,
    height: 32,
    backgroundColor: '#6c63ff',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionNumberText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  questionMeta: {
    flex: 1,
    marginLeft: 12,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  sourceText: {
    color: '#4CAF50',
    fontSize: 11,
    fontWeight: '500',
  },
  favoriteButton: {
    padding: 8,
  },
  questionText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 24,
    marginBottom: 12,
  },
  revealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  revealButtonText: {
    color: '#6c63ff',
    fontSize: 14,
    fontWeight: '600',
  },
  answerContainer: {
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  answerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6c63ff',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  answerText: {
    fontSize: 15,
    color: '#ccc',
    lineHeight: 22,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 24,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  modalIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOptionText: {
    flex: 1,
    marginLeft: 16,
  },
  modalOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalOptionDesc: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  modalCancel: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff4757',
  },
});
