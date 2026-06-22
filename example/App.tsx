import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { runSmokeTests, type SmokeTestResult } from './SmokeTests';

export default function App() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SmokeTestResult[]>([]);

  const execute = async () => {
    setRunning(true);
    try {
      setResults(await runSmokeTests());
    } finally {
      setRunning(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>SQLite Kit Native Smoke Tests</Text>
        <Text style={styles.subtitle}>Run this on both iOS and Android before publishing a release.</Text>
        <TouchableOpacity style={styles.button} onPress={execute} disabled={running}>
          <Text style={styles.buttonText}>{running ? 'Running…' : 'Run tests'}</Text>
        </TouchableOpacity>
        {results.map((result) => (
          <View key={result.name} style={styles.row}>
            <Text style={styles.status}>{result.passed ? 'PASS' : 'FAIL'}</Text>
            <View style={styles.detail}>
              <Text style={styles.name}>{result.name}</Text>
              <Text>{result.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 22 },
  button: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, alignSelf: 'flex-start', backgroundColor: '#111' },
  buttonText: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  status: { width: 42, fontWeight: '700' },
  detail: { flex: 1, gap: 2 },
  name: { fontWeight: '700' },
});
