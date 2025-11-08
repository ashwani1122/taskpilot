// import './App.css';
import React from 'react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, doc,  addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import {
  LayoutDashboard, Users, MessageSquare, Briefcase, Sun, Moon, Plus, Trash2, GitBranch, Send, CheckCircle, Loader, X, Settings, Filter, PenTool, Square, Triangle, Move
} from 'lucide-react';

// --- Global Variable Setup (Mandatory for Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-taskpilot-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Helper to convert Firebase timestamp to readable string
const formatTimestamp = (timestamp) => {
  if (!timestamp || !timestamp.toDate) return 'Just now';
  const date = timestamp.toDate();
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

// Simple reusable button component with animations
const AnimatedButton = ({ children, onClick, className = '', disabled = false, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`px-4 py-2 font-semibold text-sm rounded-lg shadow-md transition-all duration-300 ease-in-out transform ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'} ${className}`}
  >
    {children}
  </button>
);

// Progress Bar component for Dashboard
const ProgressBar = ({ progress }) => {
  const color = progress === 100 ? 'bg-green-500' : progress > 70 ? 'bg-cyan-400' : 'bg-indigo-500';
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
      <div
        className={`h-2.5 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${progress}%` }}
      ></div>
    </div>
  );
};

// --- CANVAS WHITEBOARD COMPONENT ---
const CanvasWhiteboard = ({ db, userId, userName, activeProjectId, darkMode, strokes, setStrokes }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState('pencil'); // 'pencil', 'rectangle', 'square', 'triangle', 'eraser'
  const [color, setColor] = useState(darkMode ? '#4ade80' : '#000000'); // Green in dark mode, Black in light mode
  const [tempStroke, setTempStroke] = useState(null); // Local state for stroke in progress
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 }); // Starting point for shapes
  
  const thickness = 4;
  const strokePath = `/artifacts/${appId}/public/data/project_drawings/${activeProjectId}/strokes`;

  // Function to save a completed stroke to Firestore
  const saveStroke = useCallback(async (stroke) => {
    if (!db || !userId) return;
    try {
      await addDoc(collection(db, strokePath), {
        ...stroke,
        userId: userId,
        userName: userName,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error("FIRESTORE DRAWING ERROR: Error saving stroke.", error);
    }
  }, [db, userId, userName, strokePath]);

  // DRAWING LOGIC: Redraw the entire canvas from the strokes array
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set background color based on theme
    ctx.fillStyle = darkMode ? '#1f2937' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw all completed strokes
    strokes.forEach(stroke => {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.thickness || thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      switch (stroke.type) {
        case 'pencil':
        case 'eraser': // Eraser is just white pencil stroke
          ctx.beginPath();
          if (stroke.points && stroke.points.length > 0) {
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            stroke.points.forEach(point => ctx.lineTo(point.x, point.y));
          }
          ctx.stroke();
          break;
        case 'rectangle':
        case 'square':
        case 'triangle':
          ctx.beginPath();
          
          const x = stroke.x;
          const y = stroke.y;
          const w = stroke.width;
          const h = stroke.height;

          if (stroke.type === 'rectangle' || stroke.type === 'square') {
            const finalW = stroke.type === 'square' ? Math.max(Math.abs(w), Math.abs(h)) * Math.sign(w) : w;
            const finalH = stroke.type === 'square' ? Math.max(Math.abs(w), Math.abs(h)) * Math.sign(h) : h;
            ctx.strokeRect(x, y, finalW, finalH);
          } else if (stroke.type === 'triangle') {
            ctx.moveTo(x + w / 2, y); // Top point
            ctx.lineTo(x + w, y + h); // Bottom right
            ctx.lineTo(x, y + h); // Bottom left
            ctx.closePath();
            ctx.stroke();
          }
          break;
        default:
          break;
      }
    });

    // Draw temporary stroke (shape in progress)
    if (tempStroke) {
      ctx.strokeStyle = tempStroke.color;
      ctx.lineWidth = tempStroke.thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      
      const x = tempStroke.x;
      const y = tempStroke.y;
      const w = tempStroke.width;
      const h = tempStroke.height;

      if (tempStroke.type === 'pencil') {
          if (tempStroke.points && tempStroke.points.length > 0) {
              ctx.moveTo(tempStroke.points[0].x, tempStroke.points[0].y);
              tempStroke.points.forEach(point => ctx.lineTo(point.x, point.y));
          }
      } else if (tempStroke.type === 'rectangle' || tempStroke.type === 'square') {
          const finalW = tempStroke.type === 'square' ? Math.max(Math.abs(w), Math.abs(h)) * Math.sign(w) : w;
          const finalH = tempStroke.type === 'square' ? Math.max(Math.abs(w), Math.abs(h)) * Math.sign(h) : h;
          ctx.strokeRect(x, y, finalW, finalH);
      } else if (tempStroke.type === 'triangle') {
          ctx.moveTo(x + w / 2, y);
          ctx.lineTo(x + w, y + h);
          ctx.lineTo(x, y + h);
          ctx.closePath();
      }

      ctx.stroke();
    }
  }, [strokes, tempStroke, darkMode]);


  // Resize handler to ensure responsiveness
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    const resizeCanvas = () => {
      // Use clientWidth/Height for responsiveness
      canvas.width = container.clientWidth; 
      canvas.height = 400; 
      redrawCanvas();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [redrawCanvas]); // Dependency on redrawCanvas is important to re-render strokes upon resize

  // Redraw whenever the global strokes data changes
  useEffect(() => {
    redrawCanvas();
  }, [strokes, redrawCanvas]);

  // Redraw when dark mode or local temp stroke changes
  useEffect(() => {
    redrawCanvas();
  }, [darkMode, tempStroke, redrawCanvas]);

  // MOUSE EVENT HANDLERS
  const getCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
  };

  const handleMouseDown = (e) => {
    if (!db || !userId) return; // Disable drawing if not connected

    const { x, y } = getCoords(e);
    setIsDrawing(true);
    setStartPoint({ x, y });
    
    // Initialize temporary stroke based on tool
    if (currentTool === 'pencil' || currentTool === 'eraser') {
      const strokeColor = currentTool === 'eraser' ? (darkMode ? '#1f2937' : '#ffffff') : color;
      setTempStroke({ 
        type: 'pencil', 
        color: strokeColor, 
        thickness: currentTool === 'eraser' ? 10 : thickness, 
        points: [{ x, y }] 
      });
    } else {
      // Initialize shape stroke
      setTempStroke({ 
        type: currentTool, 
        color: color, 
        thickness: thickness, 
        x: x, y: y, width: 0, height: 0 
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !tempStroke) return;

    const { x, y } = getCoords(e);

    if (currentTool === 'pencil' || currentTool === 'eraser') {
      // Freehand drawing: append point
      setTempStroke(prev => ({ 
        ...prev, 
        points: [...prev.points, { x, y }] 
      }));
    } else {
      // Shape drawing: update width/height
      const width = x - startPoint.x;
      const height = y - startPoint.y;

      // Handle square constraints (maintain aspect ratio)
      if (currentTool === 'square') {
          const size = Math.max(Math.abs(width), Math.abs(height));
          setTempStroke(prev => ({ 
              ...prev, 
              width: size * Math.sign(width), 
              height: size * Math.sign(height) 
          }));
      } else {
          setTempStroke(prev => ({ 
              ...prev, 
              width: width, 
              height: height 
          }));
      }
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !tempStroke) return;
    
    // Save the completed stroke to Firestore
    saveStroke(tempStroke);

    // Reset local state
    setIsDrawing(false);
    setTempStroke(null);
  };
  
  // --- RENDERING ---

  const tools = [
    { name: 'pencil', icon: PenTool, color: 'text-yellow-500' },
    { name: 'rectangle', icon: Square, color: 'text-indigo-500' },
    { name: 'square', icon: Move, color: 'text-pink-500' }, // Using Move icon for a squared constraint
    { name: 'triangle', icon: Triangle, color: 'text-green-500' },
    { name: 'eraser', icon: Trash2, color: 'text-red-500' },
  ];

  return (
    <div className="flex flex-col space-y-4">
      {/* Tool Selection and Color Picker */}
      <div className="bg-white dark:bg-gray-800 p-3 rounded-xl shadow-lg flex flex-wrap gap-4 items-center justify-between">
        <div className="flex space-x-2">
          {tools.map(tool => (
            <button
              key={tool.name}
              onClick={() => {
                setCurrentTool(tool.name);
                // Set default color back if switching from eraser
                if (tool.name !== 'eraser') {
                    setColor(darkMode ? '#4ade80' : '#000000');
                }
              }}
              className={`p-2 rounded-full transition duration-150 border-2 ${tool.color} ${
                currentTool === tool.name
                  ? 'bg-indigo-100 dark:bg-indigo-700 border-indigo-500 dark:border-cyan-400 shadow-md'
                  : 'bg-gray-50 dark:bg-gray-700 border-transparent hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title={`Tool: ${tool.name}`}
            >
              <tool.icon className="w-5 h-5" />
            </button>
          ))}
        </div>
        
        <div className="flex items-center space-x-4">
            {/* Color Picker (disabled for eraser) */}
            <label className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Color:</span>
                <input
                    type="color"
                    value={color}
                    onChange={(e) => {
                        setColor(e.target.value);
                        setCurrentTool('pencil'); // Switch back to pencil if color changes
                    }}
                    disabled={currentTool === 'eraser'}
                    className={`w-10 h-10 rounded-lg cursor-pointer transition duration-150 ${currentTool === 'eraser' ? 'opacity-50' : ''}`}
                    title="Select drawing color"
                />
            </label>
            
            {/* Clear All Button */}
            <AnimatedButton
                onClick={async () => {
                    // NOTE: In a real app, bulk delete is better. Here, we simulate clearance by deleting one document 
                    // and relying on security rules, or simply asking the user to refresh.
                    // For simplicity, we only clear the local state to show the effect immediately.
                    setStrokes([]);
                    // Optional: Add a mechanism to delete all docs in the collection for a true clear.
                    console.log("Canvas cleared locally. Note: Firestore cleanup is recommended for production apps.");
                }}
                // disabled={!db || !userId}
                className="bg-red-500 text-white hover:bg-red-600"
                title="Clear all drawings"
            >
                Clear All
            </AnimatedButton>
        </div>
      </div>
      
      {/* Canvas Area */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={isDrawing ? handleMouseUp : undefined} // Finish stroke if mouse leaves
          className="cursor-crosshair w-full h-full"
          style={{touchAction: 'none'}} // Prevent touch scrolling
        />
      </div>
    </div>
  );
};

// Main Application Component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("Loading...");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeView, setActiveView] = useState('dashboard');
  const [chatMessages, setChatMessages] = useState([]);
  const [drawingStrokes, setDrawingStrokes] = useState([]); // NEW: State for collaborative drawing

  // --- FIREBASE INITIALIZATION AND AUTHENTICATION ---
  useEffect(() => {
    if (!firebaseConfig.apiKey) {
      console.error("FIREBASE ERROR: Configuration is missing.");
      setIsAuthReady(true);
      return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        const dbInstance = getFirestore(app);
        const authInstance = getAuth(app);

        setDb(dbInstance);
        setAuth(authInstance);

        const authenticate = async () => {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(authInstance, initialAuthToken);
            } else {
              await signInAnonymously(authInstance);
            }
          } catch (error) {
            console.error("AUTH ERROR: Firebase authentication failed.", error);
          }
        };

        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
          if (user) {
            setUserId(user.uid);
            // Simulate a user name based on their unique ID
            setUserName(`User_${user.uid.substring(0, 4)}`); 
          } else {
            setUserId(null);
            setUserName("Guest User");
          }
          setIsAuthReady(true);
          console.log(`AUTH READY: User ID: ${user ? user.uid : 'N/A'}`);
        });

        authenticate();
        return () => unsubscribe();
    } catch (e) {
        console.error("FIREBASE INIT CRITICAL ERROR:", e);
        setIsAuthReady(true);
    }
  }, []);

  // --- REAL-TIME PROJECT DATA FETCHING ---
  useEffect(() => {
    // Only proceed if DB is initialized and Auth state is confirmed
    if (!db || !isAuthReady || !userId) {
        if (isAuthReady) console.warn("FIRESTORE PROJECT: Waiting for required dependencies (DB/UserID).");
        return;
    }
    
    // Public path for collaborative projects
    const projectsPath = `/artifacts/${appId}/public/data/projects`;
    const projectsRef = collection(db, projectsPath);
    // Order by latest update to show active projects first
    const q = query(projectsRef, orderBy('lastUpdated', 'desc'));

    console.log("FIRESTORE: Attaching project listener to:", projectsPath);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Ensure tasks array is present, even if empty
        tasks: doc.data().tasks || [],
        // Ensure teamMembers array is present
        teamMembers: doc.data().teamMembers || [],
      }));
      setProjects(projectsData);
      
      if (!activeProjectId && projectsData.length > 0) {
        setActiveProjectId(projectsData[0].id);
      } else if (activeProjectId && !projectsData.some(p => p.id === activeProjectId)) {
        setActiveProjectId(projectsData.length > 0 ? projectsData[0].id : null);
      }
    }, (error) => {
      console.error("FIRESTORE ERROR: Failed to fetch projects.", error);
    });

    return () => unsubscribe();
  }, [db, isAuthReady, userId, activeProjectId]);

  // --- REAL-TIME CHAT DATA FETCHING ---
  useEffect(() => {
    if (!db || !isAuthReady || !activeProjectId || activeView !== 'chat' || !userId) return;

    // Chat path specific to the active project
    const chatPath = `/artifacts/${appId}/public/data/project_chats/${activeProjectId}/messages`;
    const chatRef = collection(db, chatPath);
    const q = query(chatRef, orderBy('timestamp', 'asc'));

    console.log("FIRESTORE: Attaching chat listener to:", chatPath);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setChatMessages(messages);
    }, (error) => {
      console.error("FIRESTORE CHAT ERROR: Failed to fetch chat messages.", error);
    });

    return () => unsubscribe();
  }, [db, isAuthReady, userId, activeProjectId, activeView]);

  // --- NEW: REAL-TIME DRAWING DATA FETCHING ---
  useEffect(() => {
    if (!db || !isAuthReady || !activeProjectId || activeView !== 'architecture' || !userId) return;

    // Drawing path specific to the active project
    const drawingPath = `/artifacts/${appId}/public/data/project_drawings/${activeProjectId}/strokes`;
    const drawingRef = collection(db, drawingPath);
    const q = query(drawingRef, orderBy('timestamp', 'asc')); // Order by timestamp to maintain draw order

    console.log("FIRESTORE: Attaching drawing listener to:", drawingPath);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const strokes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setDrawingStrokes(strokes);
    }, (error) => {
      console.error("FIRESTORE DRAWING ERROR: Failed to fetch strokes.", error);
    });

    return () => unsubscribe();
  }, [db, isAuthReady, userId, activeProjectId, activeView]);

  // --- ACTIONS ---

  const handleUpdateProject = async (projectId, updates) => {
    if (!db || !userId) {
        console.error("UPDATE FAILED: DB or User ID not ready.");
        return;
    }
    try {
      await updateDoc(doc(db, `/artifacts/${appId}/public/data/projects`, projectId), {
        ...updates,
        lastUpdated: serverTimestamp()
      });
      // console.log("Project updated:", projectId);
    } catch (error) {
      console.error("FIRESTORE ERROR: Error updating project.", error);
    }
  };
  
  const handleCreateProject = async (projectName) => {
    const projectPath = `/artifacts/${appId}/public/data/projects`;
    
    if (!db || !userId) {
        console.error("CREATE PROJECT FAILED: DB or User ID not ready.", { db: !!db, userId: !!userId });
        return;
    }
    
    try {
      const newProjectRef = await addDoc(collection(db, projectPath), {
        name: projectName,
        status: 'Planning',
        progress: 0,
        // Start with the creator as the first team member
        teamMembers: [{ userId: userId, name: userName }],
        tasks: [
            { id: crypto.randomUUID(), description: "Set up project architecture", assigneeId: userId, status: "To Do", priority: 'High', dueDate: null }
        ],
        lastUpdated: serverTimestamp(),
        createdAt: serverTimestamp()
      });
      setActiveProjectId(newProjectRef.id);
      setActiveView('dashboard');
      console.log("SUCCESS: Project created:", newProjectRef.id);
    } catch (error) {
      console.error("FIRESTORE ERROR: Error creating project.", error);
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!db || !userId) {
        console.error("DELETE FAILED: DB or User ID not ready.");
        return;
    }
    // Using simple console log instead of confirm/alert
    console.log(`ATTEMPTING TO DELETE PROJECT: ${projectId}`);
    // if (!window.confirm("Are you sure you want to delete this project?")) return; // Replaced with console log and assuming yes for demonstration.
    try {
      await deleteDoc(doc(db, `/artifacts/${appId}/public/data/projects`, projectId));
      setActiveProjectId(null); 
    } catch (error) {
      console.error("FIRESTORE ERROR: Error deleting project.", error);
    }
  };
  
  // Task management (using embedded array for simplicity and speed)
  const handleUpdateTask = (project, taskId, updates) => {
    if (!project) return;
    
    const newTasks = project.tasks.map(task => 
      task.id === taskId ? { ...task, ...updates } : task
    );
    
    // Recalculate progress: percentage of 'Done' tasks
    const doneCount = newTasks.filter(t => t.status === 'Done').length;
    const totalCount = newTasks.length;
    const newProgress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    handleUpdateProject(project.id, { tasks: newTasks, progress: newProgress });
  };
  
  const handleAddTask = (project, description, assigneeId, priority, dueDate) => {
    if (!project || !description.trim()) return;
    const newTask = {
      id: crypto.randomUUID(),
      description,
      assigneeId: assigneeId || userId,
      status: 'To Do', // Initial Kanban column
      priority: priority || 'Medium',
      dueDate: dueDate || null
    };
    handleUpdateProject(project.id, { tasks: [...project.tasks, newTask] });
  };
  
  // Chat messaging
  const handleSendMessage = async (text) => {
    const chatPath = `/artifacts/${appId}/public/data/project_chats/${activeProjectId}/messages`;

    if (!db || !activeProjectId || text.trim() === '' || !userId) {
        console.error("SEND FAILED: Dependencies missing.");
        return;
    }

    try {
      await addDoc(collection(db, chatPath), {
        senderId: userId,
        senderName: userName,
        text: text,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error("FIRESTORE CHAT ERROR: Error sending message.", error);
    }
  };


  // --- DERIVED STATE ---
  const activeProject = useMemo(() => projects.find(p => p.id === activeProjectId), [projects, activeProjectId]);
  
  // Simple unique user list for assignment dropdown
  const uniqueTeamMembers = useMemo(() => {
    if (!activeProject) return [];
    const membersMap = new Map();
    activeProject.teamMembers.forEach(member => {
        if (!membersMap.has(member.userId)) {
            membersMap.set(member.userId, member);
        }
    });
    return Array.from(membersMap.values());
  }, [activeProject]);


  // --- SUB COMPONENTS ---
  
  // Custom Modal implementation instead of window.confirm
  const Modal = ({ title, children, isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-70 backdrop-blur-sm transition-opacity duration-300">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg p-6 m-4 animate-slideDown">
          <div className="flex justify-between items-start border-b pb-3 mb-4 border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold text-indigo-600 dark:text-cyan-400">{title}</h3>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  };

  const ProjectSelector = () => (
    <div className="p-4 border-b border-gray-200 dark:border-gray-700">
      <h2 className="text-lg font-bold mb-3 text-indigo-600 dark:text-cyan-400">Projects</h2>
      {projects.map(project => (
        <div
          key={project.id}
          onClick={() => { setActiveProjectId(project.id); setActiveView('dashboard'); }} 
          className={`p-2 my-1 rounded-lg cursor-pointer transition duration-200 ${
            project.id === activeProjectId
              ? 'bg-indigo-100 dark:bg-indigo-800/50 border-l-4 border-indigo-600 dark:border-cyan-400 font-semibold'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          {project.name}
          <ProgressBar progress={project.progress || 0} />
        </div>
      ))}
      <AnimatedButton
        onClick={() => setActiveView('newProject')}
        // disabled={!db || !userId}
        className="w-full mt-3 bg-cyan-500 text-white hover:bg-cyan-600 flex items-center justify-center"
      >
        <Plus className="w-4 h-4 mr-2" /> New Project
      </AnimatedButton>
    </div>
  );
  
  const DashboardView = ({ project }) => (
    <div className="p-6 space-y-8">
      {/* Project Progress Visualization (Graph Simulation) */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg transition-all duration-300 transform hover:shadow-xl">
        <h3 className="text-xl font-bold mb-4 text-indigo-600 dark:text-cyan-400 flex items-center">
          <LayoutDashboard className="w-5 h-5 mr-2" /> Project Progress (Real-Time)
        </h3>
        <div className="flex justify-between items-center mb-2">
          <span className="text-lg font-medium">Completion:</span>
          <span className={`text-3xl font-extrabold ${project.progress === 100 ? 'text-green-500' : 'text-cyan-400'}`}>{project.progress}%</span>
        </div>
        <ProgressBar progress={project.progress || 0} />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Status: <span className="font-semibold">{project.status}</span> | Last Sync: {formatTimestamp(project.lastUpdated)}
        </p>
      </div>

      {/* Team Working on Project (Wire Relation Simulation) */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg transition-all duration-300 transform hover:shadow-xl">
        <h3 className="text-xl font-bold mb-4 text-indigo-600 dark:text-cyan-400 flex items-center">
          <Users className="w-5 h-5 mr-2" /> Team Members & Roles
        </h3>
        <div className="space-y-3">
          {uniqueTeamMembers.map((member, index) => (
            <div
              key={member.userId}
              className={`flex items-center p-3 rounded-lg border-l-4 ${member.userId === userId ? 'border-cyan-400 bg-cyan-50 dark:bg-gray-700/50' : 'border-indigo-400 bg-indigo-50 dark:bg-gray-700'}`}
            >
              <div className="w-8 h-8 rounded-full bg-indigo-200 dark:bg-indigo-600 flex items-center justify-center text-sm font-bold text-gray-800 dark:text-white mr-3">
                {member.name.charAt(5)}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-white">{member.name} {member.userId === userId && '(You)'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    {/* Wire relation simulation */}
                  {member.userId === project.teamMembers[0]?.userId ? 'Project Owner / Lead' : (index % 2 === 0 ? 'Backend Focus / Developer' : 'Frontend Focus / Tester')}
                </p>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">ID: {member.userId.substring(0, 8)}...</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const TasksView = ({ project }) => {
    const [newTaskDescription, setNewTaskDescription] = useState('');
    const [newTaskAssignee, setNewTaskAssignee] = useState(userId);
    const [newTaskPriority, setNewTaskPriority] = useState('Medium');
    const [filterStatus, setFilterStatus] = useState('All');

    const handleNewTask = () => {
      if (newTaskDescription.trim()) {
        handleAddTask(project, newTaskDescription.trim(), newTaskAssignee, newTaskPriority);
        setNewTaskDescription('');
      }
    };
    
    const filteredTasks = project.tasks.filter(task => 
        filterStatus === 'All' || task.status === filterStatus
    );

    const taskStatuses = ['To Do', 'In Progress', 'Done'];

    return (
      <div className="p-6 space-y-6">
        <h3 className="text-xl font-bold text-indigo-600 dark:text-cyan-400 flex items-center mb-4">
          <Briefcase className="w-5 h-5 mr-2" /> Task Management (Kanban Simulation)
        </h3>

        {/* Task Input Section */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-lg flex flex-col gap-3">
          <div className="flex gap-2 w-full">
            <input
                type="text"
                placeholder="Assign a new task description..."
                value={newTaskDescription}
                onChange={(e) => setNewTaskDescription(e.target.value)}
                className="flex-1 p-3 border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white focus:ring-cyan-500 focus:border-cyan-500 transition duration-150"
                onKeyDown={(e) => e.key === 'Enter' && handleNewTask()}
                // disabled={!db || !userId}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <select
                value={newTaskAssignee}
                onChange={(e) => setNewTaskAssignee(e.target.value)}
                className="p-3 border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                // disabled={!db || !userId}
            >
                <option value={userId} disabled>Assign To...</option>
                {uniqueTeamMembers.map(member => (
                <option key={member.userId} value={member.userId}>
                    {member.name}
                </option>
                ))}
            </select>
            <select
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value)}
                className="p-3 border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                // disabled={!db || !userId}
            >
                <option value="High">Priority: High</option>
                <option value="Medium">Priority: Medium</option>
                <option value="Low">Priority: Low</option>
            </select>
            <AnimatedButton
                onClick={handleNewTask}
                disabled={!db || !userId || !newTaskDescription.trim()}
                className="bg-indigo-600 text-white hover:bg-indigo-700 flex-1 md:flex-none"
            >
                Add Task
            </AnimatedButton>
          </div>
        </div>
        
        {/* Filter Bar */}
        <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg shadow-inner">
            <div className="flex items-center text-sm font-semibold text-gray-700 dark:text-gray-300">
                <Filter className="w-4 h-4 mr-2" /> Filter by Status:
            </div>
            <div className="flex space-x-2">
                {['All', 'To Do', 'In Progress', 'Done'].map(status => (
                    <button
                        key={status}
                        onClick={() => setFilterStatus(status)}
                        className={`px-3 py-1 text-xs rounded-full transition duration-150 ${
                            filterStatus === status
                                ? 'bg-cyan-500 text-white shadow-md'
                                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-cyan-100 dark:hover:bg-gray-600'
                        }`}
                    >
                        {status}
                    </button>
                ))}
            </div>
        </div>

        {/* Task List */}
        <div className="space-y-3">
          {filteredTasks.map(task => {
            const assignee = uniqueTeamMembers.find(m => m.userId === task.assigneeId) || { name: 'Unassigned', userId: null };
            const isUser = task.assigneeId === userId;
            const statusColor = task.status === 'Done' ? 'border-green-500' : task.status === 'In Progress' ? 'border-yellow-500' : 'border-red-500';
            const priorityColor = task.priority === 'High' ? 'text-red-500' : task.priority === 'Medium' ? 'text-orange-500' : 'text-green-500';
            
            return (
              <div
                key={task.id}
                className={`flex flex-col md:flex-row items-start p-4 rounded-xl shadow-md transition duration-300 transform hover:scale-[1.01] bg-white dark:bg-gray-800 border-l-4 ${statusColor}`}
              >
                <div className="flex-1 min-w-0 pr-4 mb-2 md:mb-0">
                  <p className={`font-medium text-gray-900 dark:text-white ${task.status === 'Done' ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}>
                    {task.description}
                  </p>
                  <div className="flex flex-wrap items-center text-xs mt-1 text-gray-600 dark:text-gray-400 space-x-3">
                    <span className="font-semibold">Assignee: <span className={isUser ? 'text-cyan-600 dark:text-cyan-400' : 'text-indigo-600 dark:text-indigo-400'}>{assignee.name}</span></span>
                    <span className={`font-bold ${priorityColor}`}>P: {task.priority}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                    <select
                        value={task.status}
                        onChange={(e) => handleUpdateTask(project, task.id, { status: e.target.value })}
                        className="p-1 border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-xs font-semibold"
                        // disabled={!db || !userId}
                    >
                        {taskStatuses.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <AnimatedButton
                        onClick={() => handleUpdateTask(project, task.id, { description: `(DELETED) ${task.description}`, status: 'Done' })}
                        // disabled={!db || !userId}
                        className="bg-red-100 text-red-600 hover:bg-red-200 p-1.5"
                        title="Delete Task"
                    >
                        <Trash2 className="w-4 h-4" />
                    </AnimatedButton>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };


  const ChatView = ({ project }) => {
    const [chatInput, setChatInput] = useState(''); 
    
    const chatEndRef = useRef(null);

    // Auto-scroll to the latest message
    useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const isChatDisabled = !db || !userId;
    
    // Local handler to send the message and clear local input state
    const handleLocalSend = () => {
        if (chatInput.trim()) {
            handleSendMessage(chatInput);
            setChatInput('');
        }
    };


    return (
      <div className="flex flex-col h-full p-6">
        <h3 className="text-xl font-bold text-indigo-600 dark:text-cyan-400 flex items-center mb-4">
          <MessageSquare className="w-5 h-5 mr-2" /> Team Chat ({project.name})
        </h3>
        
        {/* Chat History Area */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700 custom-scrollbar">
          {chatMessages.map((msg, index) => {
            const isUser = msg.senderId === userId;
            return (
              <div
                key={msg.id || index}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}
              >
                <div className={`max-w-xs md:max-w-md lg:max-w-lg p-3 rounded-xl shadow-lg transition duration-300 ${isUser ? 'bg-cyan-500 text-white rounded-br-none' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-tl-none'}`}>
                  {!isUser && (
                    <p className="text-xs font-bold mb-1 opacity-80 text-indigo-700 dark:text-indigo-300">
                      {msg.senderName}
                    </p>
                  )}
                  <p>{msg.text}</p>
                  <span className={`block text-right text-xs mt-1 ${isUser ? 'text-white opacity-70' : 'text-gray-500 dark:text-gray-400'}`}>
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={isChatDisabled ? "Connecting to chat..." : "Type your message to the team..."}
            value={chatInput} // Using local state
            onChange={(e) => setChatInput(e.target.value)} // Using local setter
            onKeyDown={(e) => e.key === 'Enter' && handleLocalSend()} // Using local handler
            className="flex-1 p-3 border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500 transition duration-150"
            disabled={isChatDisabled}
          />
          <AnimatedButton
            onClick={handleLocalSend} // Using local handler
            disabled={isChatDisabled || chatInput.trim() === ''}
            className="bg-indigo-600 text-white hover:bg-indigo-700 p-3"
          >
            <Send className="w-5 h-5" />
          </AnimatedButton>
        </div>
      </div>
    );
  };

  // UPDATED: ArchitectureView now includes the CanvasWhiteboard for collaborative drawing
  const ArchitectureView = ({ project }) => {
    
    return (
      <div className="p-6 space-y-6 h-full">
        <h3 className="text-xl font-bold text-indigo-600 dark:text-cyan-400 flex items-center mb-4">
          <GitBranch className="w-5 h-5 mr-2" /> Collaborative Design Whiteboard
        </h3>
        
        <p className="text-gray-700 dark:text-gray-300">
            Use the tools below to draw architectures, brainstorm flows, and discuss designs with your team in real time!
        </p>

        {/* Inject the real-time Canvas Whiteboard */}
        <CanvasWhiteboard
            db={db}
            userId={userId}
            userName={userName}
            activeProjectId={project.id}
            darkMode={darkMode}
            strokes={drawingStrokes}
            setStrokes={setDrawingStrokes}
        />
        
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl shadow-lg mt-4 border border-cyan-400/50">
            <h4 className="text-lg font-bold text-cyan-600 dark:text-cyan-400 mb-2">Team Discussion Notes</h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">This section simulates a note-taking area for documenting the final architecture design discussed on the whiteboard.</p>
        </div>
      </div>
    );
  };

  const NewProjectView = () => {
    const [projectName, setProjectName] = useState('');
    const handleCreate = () => {
      if (projectName.trim()) {
        handleCreateProject(projectName.trim());
        setProjectName('');
      }
    };

    return (
      <div className="p-6 space-y-6">
        <h3 className="text-xl font-bold text-indigo-600 dark:text-cyan-400 flex items-center mb-4">
          <Plus className="w-5 h-5 mr-2 flex" /> Create New Project
        </h3>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg space-y-4">
          <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Project Name</label>
          <input
            id="projectName"
            type="text"
            placeholder="e.g., TaskPilot Feature Implementation"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white focus:ring-cyan-500 focus:border-cyan-500 transition duration-150"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            // disabled={!db || !userId}
          />
          <AnimatedButton
            onClick={handleCreate}
            className="w-full bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            // disabled={!projectName.trim() || !db || !userId}
          >
            Create & Launch Project
          </AnimatedButton>
          <AnimatedButton
            onClick={() => setActiveView(activeProject ? 'dashboard' : 'newProject')}
            className="w-full bg-gray-400 text-white hover:bg-gray-500"
          >
            Cancel
          </AnimatedButton>
        </div>
      </div>
    );
  };


  // --- MAIN RENDER LOGIC ---

  const ActiveProjectContent = () => {
    if (activeView === 'newProject') {
        return <NewProjectView />;
    }
    
    if (!activeProject) {
      return (
        <div className="h-full flex flex-col justify-center items-center text-gray-500 dark:text-gray-400 p-8">
          <Briefcase className="w-16 h-16 mb-4 text-indigo-400" />
          <p className="text-xl font-semibold mb-4">No Project Active</p>
          <p className="text-center">Please select a project from the left or create a new one to begin collaborating in real-time.</p>
          <AnimatedButton
            onClick={() => setActiveView('newProject')}
            // disabled={!db || !userId}
            className="mt-6 bg-cyan-500 text-white hover:bg-cyan-600"
          >
            <Plus className="w-4 h-4 mr-2" /> Create New Project
          </AnimatedButton>
        </div>
      );
    }

    let ContentComponent;
    switch (activeView) {
      case 'tasks': ContentComponent = TasksView; break;
      case 'chat': ContentComponent = ChatView; break;
      case 'architecture': ContentComponent = ArchitectureView; break;
      case 'dashboard':
      default: ContentComponent = DashboardView; break;
    }

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header/Navbar */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-md flex-shrink-0">
          <h1 className="text-2xl font-extrabold text-indigo-600 dark:text-cyan-400 transition-colors duration-300 truncate">
            {activeProject.name}
          </h1>

          {/* Delete Button (Top Right) */}
          <AnimatedButton
            onClick={() => handleDeleteProject(activeProject.id)}
            // disabled={!db || !userId}
            className="bg-red-500 text-white hover:bg-red-600 flex items-center ml-4"
          >
            <Trash2 className="w-4 h-4 mr-1" /> Delete Project
          </AnimatedButton>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
          <ContentComponent project={activeProject} />
        </div>
      </div>
    );
  };

  // Render a loading spinner if Firebase is not ready
  if (!isAuthReady) {
    return (
        <div className={`h-screen w-screen flex items-center justify-center ${darkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
            <div className="flex flex-col items-center text-indigo-600 dark:text-cyan-400 animate-pulse">
                <Loader className="w-12 h-12 animate-spin mb-4" />
                <p className="text-lg font-semibold dark:text-white">Connecting to TaskPilot Services...</p>
                <p className="text-sm text-gray-500">Authenticating user and preparing real-time dashboard.</p>
            </div>
        </div>
    );
  }


  // Main App return structure
  return (
    <div className={`h-screen w-screen flex text-gray-900 dark:text-white transition-colors duration-300 ${darkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
        body { font-family: 'Inter', sans-serif; }
        
        /* Custom scrollbar for better aesthetics */
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: ${darkMode ? '#1f2937' : '#f3f4f6'}; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: ${darkMode ? '#4b5563' : '#9ca3af'}; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: ${darkMode ? '#6b7280' : '#6b7280'}; }
        
        /* Animation Keyframes */
        @keyframes slideDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideDown { animation: slideDown 0.5s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        @keyframes draw { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
        .animate-draw { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: draw 2s ease-out forwards; }
      `}</style>
      
      {/* 1. Sidebar (Fixed Width, Mobile Hidden) */}
      <div className="hidden md:flex flex-col w-64 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl flex-shrink-0">
        <div className="p-4 text-center border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-3xl font-extrabold text-indigo-700 dark:text-cyan-500">TaskPilot</h1>
          <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">Real-Time MVP</p>
        </div>

        <ProjectSelector />

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 border-b border-gray-200 dark:border-gray-700">
          {[
            { name: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
            { name: 'Tasks (Kanban View)', icon: Briefcase, view: 'tasks' },
            { name: 'Team Chat', icon: MessageSquare, view: 'chat' },
            { name: 'Architecture Class', icon: GitBranch, view: 'architecture' },
          ].map(item => (
            <div
              key={item.name}
              onClick={() => activeProject && setActiveView(item.view)}
              className={`flex items-center p-3 rounded-lg cursor-pointer transition duration-200 ${
                activeView === item.view
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-indigo-600 dark:hover:text-cyan-400'
              } ${!activeProject && item.view !== 'newProject' ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <item.icon className="w-5 h-5 mr-3" />
              <span className="font-medium">{item.name}</span>
            </div>
          ))}
        </nav>
        
        {/* User Info and Theme Toggle */}
        <div className="p-4 flex items-center justify-between text-sm border-t border-gray-200 dark:border-gray-700">
          <div className="flex flex-col">
            <span className="font-semibold text-gray-700 dark:text-gray-300 truncate">
              {userName}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              ID: {userId ? userId.substring(0, 8) + '...' : 'N/A'}
            </span>
          </div>
          
          {/* Toggle Mode Button */}
          <AnimatedButton
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 ml-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            title="Toggle Dark/Light Mode"
          >
            {darkMode ? <Sun className="w-5 h-5 text-cyan-400" /> : <Moon className="w-5 h-5 text-indigo-600" />}
          </AnimatedButton>
        </div>
      </div>

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ActiveProjectContent />
      </div>
    </div>
  );
};

export default App;