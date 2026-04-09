import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Play from './pages/Play';
import Results from './pages/Results';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lobby/:roomCode" element={<Lobby />} />
        <Route path="/join/:roomCode" element={<Lobby />} />
        <Route path="/play/:roomCode" element={<Play />} />
        <Route path="/results/:roomCode" element={<Results />} />
      </Routes>
    </BrowserRouter>
  );
}
