import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface FavoriteQuestion {
  id: string;
  question: string;
  answer: string;
  category: string;
  job_description: string;
  source?: string;
  source_url?: string;
  company?: string;
  created_at: string;
}

export default function FavoritesScreen() {
  const [favorites, setFavorites] = useState<FavoriteQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const fetchFavorites = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/favorites`);
      setFavorites(response.data);
    } catch (error) {
      console.error('Error fetching favorites:', error);
      Alert.alert('Error', 'Failed to load favorites');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchFavorites();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchFavorites();
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

  const removeFavorite = async (id: string) => {
    Alert.alert(
      'Remove Favorite',
      'Are you sure you want to remove this question from favorites?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeletingIds((prev) => new Set(prev).add(id));
            try {
              await axios.delete(`${API_URL}/api/favorites/${id}`);
              setFavorites((prev) => prev.filter((f) => f.id !== id));
            } catch (error) {
              console.error('Error removing favorite:', error);
              Alert.alert('Error', 'Failed to remove favorite');
            } finally {
              setDeletingIds((prev) => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
              });
            }
          },
        },
      ]
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'technical':
        return 'code-slash';
      case 'behavioral':
        return 'people';
      case 'situational':
        return 'bulb';
      default:
        return 'help-circle';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'technical':
        return '#6c63ff';
      case 'behavioral':
        return '#FF9800';
      case 'situational':
        return '#2196F3';
      default:
        return '#4CAF50';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6c63ff" />
          <Text style={styles.loadingText}>Loading favorites...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6c63ff"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Favorites</Text>
          <Text style={styles.subtitle}>
            {favorites.length} saved question{favorites.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {favorites.length > 0 && (
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
        )}

        {/* Empty State */}
        {favorites.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="heart-outline" size={64} color="#444" />
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptySubtitle}>
              Save questions from the Prepare tab to review them later
            </Text>
          </View>
        ) : (
          <View style={styles.favoritesList}>
            {favorites.map((fav) => (
              <View key={fav.id} style={styles.favoriteCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.badgesContainer}>
                    <View
                      style={[
                        styles.categoryBadge,
                        { backgroundColor: getCategoryColor(fav.category) + '20' },
                      ]}
                    >
                      <Ionicons
                        name={getCategoryIcon(fav.category) as any}
                        size={14}
                        color={getCategoryColor(fav.category)}
                      />
                      <Text
                        style={[
                          styles.categoryText,
                          { color: getCategoryColor(fav.category) },
                        ]}
                      >
                        {fav.category.charAt(0).toUpperCase() + fav.category.slice(1)}
                      </Text>
                    </View>
                    {fav.source === 'web_search' && (
                      <View style={styles.webBadge}>
                        <Ionicons name="globe" size={12} color="#4CAF50" />
                        <Text style={styles.webBadgeText}>Verified</Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => removeFavorite(fav.id)}
                    disabled={deletingIds.has(fav.id)}
                  >
                    {deletingIds.has(fav.id) ? (
                      <ActivityIndicator size="small" color="#ff4757" />
                    ) : (
                      <Ionicons name="trash-outline" size={20} color="#ff4757" />
                    )}
                  </TouchableOpacity>
                </View>

                {fav.company && (
                  <View style={styles.companyTag}>
                    <Ionicons name="business" size={12} color="#888" />
                    <Text style={styles.companyText}>{fav.company}</Text>
                  </View>
                )}

                <Text style={styles.questionText}>{fav.question}</Text>

                {fav.source === 'web_search' && fav.source_url && (
                  <View style={styles.sourceUrlContainer}>
                    <Ionicons name="link" size={12} color="#4CAF50" />
                    <Text style={styles.sourceUrlText}>{fav.source_url}</Text>
                  </View>
                )}

                {practiceMode ? (
                  <TouchableOpacity
                    style={styles.revealButton}
                    onPress={() => toggleAnswer(fav.id)}
                  >
                    <Ionicons
                      name={revealedAnswers.has(fav.id) ? 'eye' : 'eye-off'}
                      size={18}
                      color="#6c63ff"
                    />
                    <Text style={styles.revealButtonText}>
                      {revealedAnswers.has(fav.id) ? 'Hide Answer' : 'Show Answer'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {(!practiceMode || revealedAnswers.has(fav.id)) && (
                  <View style={styles.answerContainer}>
                    <Text style={styles.answerLabel}>
                      {fav.source === 'web_search' ? 'Suggested Approach:' : 'Sample Answer:'}
                    </Text>
                    <Text style={styles.answerText}>{fav.answer}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
    marginTop: 16,
  },
  practiceModeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  favoritesList: {
    gap: 16,
  },
  favoriteCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  badgesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  webBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  webBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4CAF50',
  },
  deleteButton: {
    padding: 8,
  },
  companyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  companyText: {
    fontSize: 13,
    color: '#888',
  },
  questionText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 24,
    marginBottom: 12,
  },
  sourceUrlContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  sourceUrlText: {
    fontSize: 12,
    color: '#4CAF50',
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
