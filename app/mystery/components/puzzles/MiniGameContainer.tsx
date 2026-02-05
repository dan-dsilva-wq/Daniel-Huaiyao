'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import type { Player, MysteryPuzzle, MinigameState } from '@/lib/supabase';

interface MiniGameContainerProps {
  puzzle: MysteryPuzzle;
  sessionId: string;
  currentPlayer: Player;
  onComplete?: (success: boolean) => void;
}

// Safe Cracker Mini-Game
function SafeCrackerGame({
  gameState,
  myState,
  currentPlayer,
  onUpdateState,
  onSubmitCode,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
  onSubmitCode: (code: string) => void;
}) {
  const [digits, setDigits] = useState<number[]>([0, 0, 0, 0]);
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';

  // Get clues from game state
  const myClues = (myState.clues as string[]) || [];
  const partnerReady = Boolean(gameState.partner_ready);
  const attempts = (gameState.attempts as number) || 0;
  const maxAttempts = 5;

  const handleDigitChange = (index: number, delta: number) => {
    const newDigits = [...digits];
    newDigits[index] = (newDigits[index] + delta + 10) % 10;
    setDigits(newDigits);

    // Sync current digit to shared state
    onUpdateState(
      { [`${currentPlayer}_digit_${index}`]: newDigits[index] },
      {}
    );
  };

  const handleSubmit = () => {
    const code = digits.join('');
    onSubmitCode(code);
  };

  return (
    <div className="space-y-6">
      {/* Clues section */}
      <div className="bg-slate-800/50 rounded-xl p-4">
        <h4 className="text-amber-400 font-medium mb-3">Your Clues:</h4>
        {myClues.length > 0 ? (
          <ul className="space-y-2">
            {myClues.map((clue, i) => (
              <li key={i} className="text-purple-200 text-sm flex items-start gap-2">
                <span className="text-amber-400">•</span>
                {clue}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-purple-300/60 text-sm italic">
            Waiting for game to initialize...
          </p>
        )}
        <p className="text-purple-300/60 text-xs mt-3">
          {partnerName} has different clues - communicate to solve!
        </p>
      </div>

      {/* Safe dial */}
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl p-6 border-4 border-slate-600">
        <div className="flex justify-center gap-4">
          {digits.map((digit, index) => (
            <div key={index} className="flex flex-col items-center">
              <button
                onClick={() => handleDigitChange(index, 1)}
                className="w-12 h-8 bg-slate-600 hover:bg-slate-500 rounded-t-lg text-white font-bold transition-colors"
              >
                ▲
              </button>
              <div className="w-12 h-16 bg-black flex items-center justify-center border-2 border-slate-500">
                <span className="text-green-400 font-mono text-3xl">{digit}</span>
              </div>
              <button
                onClick={() => handleDigitChange(index, -1)}
                className="w-12 h-8 bg-slate-600 hover:bg-slate-500 rounded-b-lg text-white font-bold transition-colors"
              >
                ▼
              </button>
            </div>
          ))}
        </div>

        {/* Attempts counter */}
        <p className="text-center text-slate-400 text-sm mt-4">
          Attempts: {attempts}/{maxAttempts}
        </p>
      </div>

      {/* Partner status */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className={`w-2 h-2 rounded-full ${partnerReady ? 'bg-green-500' : 'bg-gray-500'}`} />
        <span className={partnerReady ? 'text-green-300' : 'text-gray-400'}>
          {partnerName} is {partnerReady ? 'ready' : 'setting their code'}
        </span>
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={attempts >= maxAttempts}
        className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-xl font-semibold transition-colors disabled:cursor-not-allowed"
      >
        {attempts >= maxAttempts ? 'No Attempts Left' : 'Try Code'}
      </button>
    </div>
  );
}

// Circuit Puzzle Mini-Game - Connect nodes to complete the circuit
function CircuitPuzzleGame({
  gameState,
  currentPlayer,
  onUpdateState,
  onSubmitCode,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
  onSubmitCode: (code: string) => void;
}) {
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';

  // 4x4 grid of nodes
  const gridSize = 4;
  const connections = (gameState.connections as Record<string, boolean>) || {};
  const targetConnections = (gameState.target as string[]) || ['0-0_0-1', '0-1_1-1', '1-1_1-2', '1-2_2-2', '2-2_3-2', '3-2_3-3'];
  const startNode = '0-0';
  const endNode = '3-3';

  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Node and grid dimensions
  const nodeSize = 48; // w-12 = 48px
  const gap = 16; // gap-4 = 16px
  const gridWidth = gridSize * nodeSize + (gridSize - 1) * gap; // 4*48 + 3*16 = 240px

  const getNodeColor = (row: number, col: number) => {
    const nodeId = `${row}-${col}`;
    if (nodeId === startNode) return 'bg-green-500';
    if (nodeId === endNode) return 'bg-red-500';
    // Check if connected
    const isConnected = Object.keys(connections).some(key =>
      connections[key] && (key.startsWith(nodeId + '_') || key.endsWith('_' + nodeId))
    );
    return isConnected ? 'bg-amber-400' : 'bg-slate-600';
  };

  const handleNodeClick = (row: number, col: number) => {
    const nodeId = `${row}-${col}`;

    if (!selectedNode) {
      setSelectedNode(nodeId);
    } else {
      // Try to connect
      if (selectedNode !== nodeId) {
        // Check if adjacent (orthogonal only - no diagonal)
        const [r1, c1] = selectedNode.split('-').map(Number);
        const isOrthogonalAdjacent = (Math.abs(r1 - row) === 1 && c1 === col) ||
                                      (Math.abs(c1 - col) === 1 && r1 === row);

        if (isOrthogonalAdjacent) {
          // Create connection key (sorted so A_B === B_A)
          const connKey = [selectedNode, nodeId].sort().join('_');
          const newConnections = { ...connections };

          // Toggle connection
          if (connections[connKey]) {
            delete newConnections[connKey];
          } else {
            newConnections[connKey] = true;
          }

          onUpdateState({ connections: newConnections }, {});
        }
      }
      setSelectedNode(null);
    }
  };

  const checkCircuit = () => {
    // Check if all target connections are made
    const allConnected = targetConnections.every(conn => {
      // Check both orderings since connections might be stored differently
      const [n1, n2] = conn.split('_');
      const reverseKey = `${n2}_${n1}`;
      return connections[conn] || connections[reverseKey];
    });
    const code = allConnected ? 'COMPLETE' : 'INCOMPLETE';
    onSubmitCode(code);
  };

  // Draw connections as SVG lines
  const renderConnections = () => {
    const lines: React.ReactNode[] = [];

    Object.keys(connections).forEach(key => {
      if (!connections[key]) return;

      const [n1, n2] = key.split('_');
      const [r1, c1] = n1.split('-').map(Number);
      const [r2, c2] = n2.split('-').map(Number);

      // Calculate center positions of nodes
      const x1 = c1 * (nodeSize + gap) + nodeSize / 2;
      const y1 = r1 * (nodeSize + gap) + nodeSize / 2;
      const x2 = c2 * (nodeSize + gap) + nodeSize / 2;
      const y2 = r2 * (nodeSize + gap) + nodeSize / 2;

      lines.push(
        <line
          key={key}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#fbbf24"
          strokeWidth="6"
          strokeLinecap="round"
        />
      );
    });

    return lines;
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 rounded-xl p-4">
        <p className="text-purple-200 text-sm text-center mb-4">
          Connect the <span className="text-green-400">green start</span> to the{' '}
          <span className="text-red-400">red end</span> by clicking nodes to create connections.
        </p>

        <div className="flex justify-center">
          <div className="relative" style={{ width: gridWidth, height: gridWidth }}>
            {/* SVG for connections - positioned exactly over the grid */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={gridWidth}
              height={gridWidth}
              style={{ zIndex: 0 }}
            >
              {renderConnections()}
            </svg>

            {/* Grid of nodes */}
            <div className="grid grid-cols-4 gap-4 relative" style={{ zIndex: 1 }}>
              {Array.from({ length: gridSize }).map((_, row) =>
                Array.from({ length: gridSize }).map((_, col) => (
                  <motion.button
                    key={`${row}-${col}`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleNodeClick(row, col)}
                    className={`
                      w-12 h-12 rounded-full transition-all shadow-lg
                      ${getNodeColor(row, col)}
                      ${selectedNode === `${row}-${col}` ? 'ring-4 ring-white' : ''}
                    `}
                  >
                    {`${row}-${col}` === startNode && <span className="text-white text-xs font-bold">IN</span>}
                    {`${row}-${col}` === endNode && <span className="text-white text-xs font-bold">OUT</span>}
                  </motion.button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-purple-300/60 text-sm">
        {partnerName} can also connect nodes - work together!
      </p>

      <button
        onClick={checkCircuit}
        className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-semibold transition-colors"
      >
        Test Circuit
      </button>
    </div>
  );
}

// Pattern Sequence Mini-Game - Simon Says style
function PatternSequenceGame({
  gameState,
  currentPlayer,
  onUpdateState,
  onSubmitCode,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
  onSubmitCode: (code: string) => void;
}) {
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';
  const colors = ['red', 'blue', 'green', 'yellow'];
  const targetSequence = (gameState.target_sequence as number[]) || [0, 2, 1, 3, 0, 1];
  const playerSequence = (gameState.player_sequence as number[]) || [];
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeColor, setActiveColor] = useState<number | null>(null);
  const [showingPattern, setShowingPattern] = useState(false);

  const colorClasses: Record<string, string> = {
    red: 'bg-red-500 hover:bg-red-400',
    blue: 'bg-blue-500 hover:bg-blue-400',
    green: 'bg-green-500 hover:bg-green-400',
    yellow: 'bg-yellow-500 hover:bg-yellow-400',
  };

  const activeClasses: Record<string, string> = {
    red: 'bg-red-300 shadow-lg shadow-red-500/50',
    blue: 'bg-blue-300 shadow-lg shadow-blue-500/50',
    green: 'bg-green-300 shadow-lg shadow-green-500/50',
    yellow: 'bg-yellow-300 shadow-lg shadow-yellow-500/50',
  };

  const playPattern = async () => {
    setShowingPattern(true);
    for (let i = 0; i < targetSequence.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      setActiveColor(targetSequence[i]);
      await new Promise(resolve => setTimeout(resolve, 400));
      setActiveColor(null);
    }
    setShowingPattern(false);
    setIsPlaying(true);
  };

  const handleColorClick = (colorIndex: number) => {
    if (showingPattern || !isPlaying) return;

    const newSequence = [...playerSequence, colorIndex];
    onUpdateState({ player_sequence: newSequence }, {});

    // Check if complete
    if (newSequence.length === targetSequence.length) {
      const isCorrect = newSequence.every((v, i) => v === targetSequence[i]);
      onSubmitCode(isCorrect ? 'CORRECT' : 'WRONG');
      setIsPlaying(false);
    }
  };

  const resetGame = () => {
    onUpdateState({ player_sequence: [] }, {});
    setIsPlaying(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 rounded-xl p-6">
        <p className="text-purple-200 text-sm text-center mb-6">
          Watch the pattern, then repeat it together!
        </p>

        <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
          {colors.map((color, index) => (
            <motion.button
              key={color}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleColorClick(index)}
              disabled={showingPattern}
              className={`
                w-full aspect-square rounded-2xl transition-all
                ${activeColor === index ? activeClasses[color] : colorClasses[color]}
                ${showingPattern ? 'cursor-not-allowed' : 'cursor-pointer'}
              `}
            />
          ))}
        </div>

        <div className="mt-6 text-center">
          <p className="text-purple-300 text-sm mb-2">
            Progress: {playerSequence.length} / {targetSequence.length}
          </p>
          <div className="flex justify-center gap-1">
            {targetSequence.map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full ${
                  i < playerSequence.length
                    ? playerSequence[i] === targetSequence[i]
                      ? 'bg-green-500'
                      : 'bg-red-500'
                    : 'bg-slate-600'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-center text-purple-300/60 text-sm">
        Both players can input - coordinate with {partnerName}!
      </p>

      <div className="flex gap-3">
        <button
          onClick={playPattern}
          disabled={showingPattern}
          className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white rounded-xl font-semibold transition-colors"
        >
          {showingPattern ? 'Watch...' : 'Show Pattern'}
        </button>
        <button
          onClick={resetGame}
          className="px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-xl font-semibold transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// Wire Matching Mini-Game
function WireMatchingGame({
  gameState,
  currentPlayer,
  onUpdateState,
  onSubmitCode,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
  onSubmitCode: (code: string) => void;
}) {
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';
  const wireColors = ['red', 'blue', 'green', 'yellow', 'purple'];
  const targetMatches = (gameState.target as Record<string, number>) || { red: 2, blue: 0, green: 3, yellow: 1, purple: 4 };
  const currentMatches = (gameState.matches as Record<string, number>) || {};

  const [selectedWire, setSelectedWire] = useState<string | null>(null);

  const colorStyles: Record<string, string> = {
    red: 'bg-red-500',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500',
  };

  const handleWireClick = (color: string) => {
    setSelectedWire(color);
  };

  const handleTerminalClick = (terminalIndex: number) => {
    if (!selectedWire) return;

    const newMatches = { ...currentMatches, [selectedWire]: terminalIndex };
    onUpdateState({ matches: newMatches }, {});
    setSelectedWire(null);
  };

  const checkConnections = () => {
    const isCorrect = wireColors.every(color => currentMatches[color] === targetMatches[color]);
    onSubmitCode(isCorrect ? 'CORRECT' : 'WRONG');
  };

  // Draw wire connections
  const renderWires = () => {
    return wireColors.map((color, i) => {
      if (currentMatches[color] === undefined) return null;

      const startY = 32 + i * 48;
      const endY = 32 + currentMatches[color] * 48;

      return (
        <path
          key={color}
          d={`M 50 ${startY} C 120 ${startY}, 180 ${endY}, 250 ${endY}`}
          stroke={color === 'yellow' ? '#eab308' : color}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      );
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 rounded-xl p-6">
        <p className="text-purple-200 text-sm text-center mb-6">
          Connect each colored wire to the correct terminal!
        </p>

        <div className="relative flex justify-between items-center" style={{ height: 240 }}>
          <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
            {renderWires()}
          </svg>

          {/* Left side - Wires */}
          <div className="flex flex-col gap-3 z-10">
            {wireColors.map(color => (
              <motion.button
                key={color}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleWireClick(color)}
                className={`
                  w-12 h-8 rounded-l-full ${colorStyles[color]}
                  ${selectedWire === color ? 'ring-4 ring-white' : ''}
                  transition-all
                `}
              />
            ))}
          </div>

          {/* Right side - Terminals */}
          <div className="flex flex-col gap-3 z-10">
            {[0, 1, 2, 3, 4].map(i => (
              <motion.button
                key={i}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleTerminalClick(i)}
                className="w-12 h-8 rounded-r-full bg-slate-500 hover:bg-slate-400 flex items-center justify-center text-white font-mono text-sm transition-all"
              >
                {i + 1}
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-center text-purple-300/60 text-sm">
        {partnerName} can also connect wires - work together!
      </p>

      <button
        onClick={checkConnections}
        className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-semibold transition-colors"
      >
        Check Connections
      </button>
    </div>
  );
}

// Logic Grid Mini-Game
function LogicGridGame({
  gameState,
  currentPlayer,
  onUpdateState,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
}) {
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';
  const _gridSize = (gameState.grid_size as number) || 4; // eslint-disable-line @typescript-eslint/no-unused-vars
  const categories = (gameState.categories as string[][]) || [['A', 'B', 'C', 'D'], ['1', '2', '3', '4']];

  // Grid state: 'empty' | 'yes' | 'no' | 'partner_yes' | 'partner_no'
  const grid = (gameState.grid as Record<string, string>) || {};

  const handleCellClick = (row: number, col: number) => {
    const key = `${row}-${col}`;
    const currentValue = grid[key] || 'empty';
    const myPrefix = currentPlayer === 'daniel' ? 'd' : 'h';

    // Cycle through: empty -> yes -> no -> empty
    let newValue: string;
    if (currentValue === 'empty' || currentValue.startsWith(currentPlayer === 'daniel' ? 'h' : 'd')) {
      newValue = `${myPrefix}_yes`;
    } else if (currentValue === `${myPrefix}_yes`) {
      newValue = `${myPrefix}_no`;
    } else {
      newValue = 'empty';
    }

    onUpdateState(
      { grid: { ...grid, [key]: newValue } },
      {}
    );
  };

  const getCellDisplay = (row: number, col: number) => {
    const key = `${row}-${col}`;
    const value = grid[key] || 'empty';

    if (value === 'empty') return '';
    if (value.endsWith('_yes')) {
      const isPartner = value.startsWith(currentPlayer === 'daniel' ? 'h' : 'd');
      return <span className={isPartner ? 'text-rose-400' : 'text-blue-400'}>✓</span>;
    }
    if (value.endsWith('_no')) {
      const isPartner = value.startsWith(currentPlayer === 'daniel' ? 'h' : 'd');
      return <span className={isPartner ? 'text-rose-400' : 'text-blue-400'}>✗</span>;
    }
    return '';
  };

  return (
    <div className="space-y-4">
      <p className="text-purple-300 text-sm text-center">
        Click cells to mark. <span className="text-blue-400">Blue = You</span>, <span className="text-rose-400">Pink = {partnerName}</span>
      </p>

      <div className="overflow-x-auto">
        <table className="mx-auto border-collapse">
          <thead>
            <tr>
              <th className="w-12 h-12"></th>
              {categories[1]?.map((cat, i) => (
                <th key={i} className="w-12 h-12 text-amber-400 text-sm font-medium">
                  {cat}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories[0]?.map((rowCat, row) => (
              <tr key={row}>
                <td className="text-amber-400 text-sm font-medium pr-2">{rowCat}</td>
                {categories[1]?.map((_, col) => (
                  <td key={col}>
                    <button
                      onClick={() => handleCellClick(row, col)}
                      className="w-12 h-12 border border-slate-600 hover:bg-slate-700/50 flex items-center justify-center text-xl transition-colors"
                    >
                      {getCellDisplay(row, col)}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MiniGameContainer({
  puzzle,
  sessionId,
  currentPlayer,
  onComplete,
}: MiniGameContainerProps) {
  const [gameState, setGameState] = useState<MinigameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchGameState = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_minigame_state', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
      p_player: currentPlayer,
    });

    if (!error && data) {
      setGameState(data);
    }
    setIsLoading(false);
  }, [sessionId, puzzle.id, currentPlayer]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGameState();

    // Subscribe to minigame state changes
    const channel = supabase
      .channel(`minigame-${sessionId}-${puzzle.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_minigame_state',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          fetchGameState();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, puzzle.id, fetchGameState]);

  const handleUpdateState = async (shared: Record<string, unknown>, private_: Record<string, unknown>) => {
    await supabase.rpc('update_minigame_state', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
      p_player: currentPlayer,
      p_shared_state: Object.keys(shared).length > 0 ? shared : null,
      p_private_state: Object.keys(private_).length > 0 ? private_ : null,
    });
  };

  const handleSubmitCode = async (code: string) => {
    // Submit as puzzle answer
    const { data } = await supabase.rpc('submit_puzzle_answer', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
      p_player: currentPlayer,
      p_answer: code,
    });

    if (data?.status === 'solved' && onComplete) {
      onComplete(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="w-8 h-8 border-4 border-purple-200 border-t-purple-500 rounded-full"
        />
      </div>
    );
  }

  const gameType = puzzle.puzzle_data.game_type;
  const sharedState = gameState?.game_state || {};
  const myState = gameState?.my_state || {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-purple-900/50 to-slate-900/50 border border-purple-500/30 rounded-xl p-6"
    >
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl">🎮</span>
        <div>
          <h3 className="text-xl font-serif font-bold text-white">{puzzle.title}</h3>
          <p className="text-purple-300 text-sm">Collaborative Mini-Game</p>
        </div>
      </div>

      <p className="text-purple-100 mb-6">{puzzle.description}</p>

      {gameType === 'safe_cracker' && (
        <SafeCrackerGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
          onSubmitCode={handleSubmitCode}
        />
      )}

      {gameType === 'logic_grid' && (
        <LogicGridGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
        />
      )}

      {gameType === 'circuit' && (
        <CircuitPuzzleGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
          onSubmitCode={handleSubmitCode}
        />
      )}

      {gameType === 'pattern_sequence' && (
        <PatternSequenceGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
          onSubmitCode={handleSubmitCode}
        />
      )}

      {gameType === 'wire_matching' && (
        <WireMatchingGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
          onSubmitCode={handleSubmitCode}
        />
      )}

      {!gameType && (
        <p className="text-center text-purple-300/60">
          Unknown mini-game type. Please contact support.
        </p>
      )}
    </motion.div>
  );
}
