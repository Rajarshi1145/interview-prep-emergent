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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Question {
  id: string;
  question: string;
  answer: string;
  category: string;
  job_description: string;
}

interface QuestionsResponse {
  technical: Question[];
  behavioral: Question[];
  situational: Question[];
}

export default function HomeScreen() {
  const [jobDescription, setJobDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<QuestionsResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('technical');
  const [practiceMode, setPracticeMode] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const generateQuestions = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('Error', 'Please enter a job description or role');
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
    { key: 'technical', label: 'Technical', icon: 'code-slash' },
    { key: 'behavioral', label: 'Behavioral', icon: 'people' },
    { key: 'situational', label: 'Situational', icon: 'bulb' },
  ];

  const currentQuestions = questions ? questions[selectedCategory as keyof QuestionsResponse] : [];

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
            <Text style={styles.subtitle}>Get ready for your dream job</Text>
          </View>

          {/* Input Section */}
          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>Job Description or Role</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g., Senior React Developer at a fintech startup..."
              placeholderTextColor="#666"
              multiline
              numberOfLines={4}
              value={jobDescription}
              onChangeText={setJobDescription}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.generateButton, loading && styles.generateButtonDisabled]}
              onPress={generateQuestions}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={20} color="#fff" />
                  <Text style={styles.generateButtonText}>Generate Questions</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Loading State */}
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6c63ff" />
              <Text style={styles.loadingText}>Generating interview questions...</Text>
              <Text style={styles.loadingSubtext}>This may take a few seconds</Text>
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
              <View style={styles.categoryTabs}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      styles.categoryTab,
                      selectedCategory === cat.key && styles.categoryTabActive,
                    ]}
                    onPress={() => setSelectedCategory(cat.key)}
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={18}
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
                  </TouchableOpacity>
                ))}
              </View>

              {/* Questions List */}
              <View style={styles.questionsList}>
                {currentQuestions.map((q, index) => (
                  <View key={q.id} style={styles.questionCard}>
                    <View style={styles.questionHeader}>
                      <View style={styles.questionNumber}>
                        <Text style={styles.questionNumberText}>{index + 1}</Text>
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
                        <Text style={styles.answerLabel}>Sample Answer:</Text>
                        <Text style={styles.answerText}>{q.answer}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
  },
  inputSection: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#2d2d44',
    marginBottom: 16,
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
  categoryTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  categoryTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  categoryTabActive: {
    backgroundColor: '#6c63ff',
    borderColor: '#6c63ff',
  },
  categoryTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  categoryTabTextActive: {
    color: '#fff',
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
    alignItems: 'center',
    justifyContent: 'space-between',
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
});
