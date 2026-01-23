/**
 * Agent Observability App
 * 
 * Single-page application for real-time agent tracing.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ObservabilityDashboard } from './components/ObservabilityDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/observability" element={<ObservabilityDashboard />} />
        <Route path="*" element={<Navigate to="/observability" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
