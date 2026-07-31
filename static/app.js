// Outlook Voice Analytics Frontend controller

let currentAgentName = null;
let currentSessionId = null;
let activePollInterval = null;
let selectedFile = null;

// DOM Elements
const btnNewAnalysis = document.getElementById("btnNewAnalysis");
const newAnalysisModal = document.getElementById("newAnalysisModal");
const modalClose = document.getElementById("modalClose");

const btnBulkUpload = document.getElementById("btnBulkUpload");
const bulkUploadModal = document.getElementById("bulkUploadModal");
const bulkModalClose = document.getElementById("bulkModalClose");
const bulkDropZone = document.getElementById("bulkDropZone");
const bulkFileInput = document.getElementById("bulkFileInput");
const bulkFileInfo = document.getElementById("bulkFileInfo");
const bulkUploadForm = document.getElementById("bulkUploadForm");
let selectedBulkFile = null;

const btnViewGraphs = document.getElementById("btnViewGraphs");
const graphsModal = document.getElementById("graphsModal");
const graphsModalClose = document.getElementById("graphsModalClose");
let currentSessionData = null;

const navAnalytics = document.getElementById("navAnalytics");
const navMail = document.getElementById("navMail");

const btnExportAgentPDF = document.getElementById("btnExportAgentPDF");
const btnExportAgentCSV = document.getElementById("btnExportAgentCSV");
const btnExportSessionPDF = document.getElementById("btnExportSessionPDF");
const btnExportSessionCSV = document.getElementById("btnExportSessionCSV");
let currentAgentSessionsData = [];

const btnReevaluateSession = document.getElementById("btnReevaluateSession");

const newAnalysisForm = document.getElementById("newAnalysisForm");
const audioFileInput = document.getElementById("audioFileInput");
const dropZone = document.getElementById("dropZone");
const fileInfo = document.getElementById("fileInfo");
const progressPanel = document.getElementById("progressPanel");
const progressMessage = document.getElementById("progressMessage");
const progressBarFill = document.getElementById("progressBarFill");
const progressPercentage = document.getElementById("progressPercentage");
const searchAgents = document.getElementById("searchAgents");
const agentList = document.getElementById("agentList");

const agentDetailsPane = document.getElementById("agentDetailsPane");
const selectedAgentName = document.getElementById("selectedAgentName");
const agentDateFilter = document.getElementById("agentDateFilter");
const agentSummaryCard = document.getElementById("agentSummaryCard");
const agentSummaryCalls = document.getElementById("agentSummaryCalls");
const agentSummaryScore = document.getElementById("agentSummaryScore");
const agentSummaryEmotion = document.getElementById("agentSummaryEmotion");
const agentSessionsList = document.getElementById("agentSessionsList");

const readingPaneContent = document.getElementById("readingPaneContent");
const emptyState = document.getElementById("emptyState");
const sessionTopic = document.getElementById("sessionTopic");
const sessionSpeakersCount = document.getElementById("sessionSpeakersCount");
const sessionDuration = document.getElementById("sessionDuration");
const sessionDetailsMeta = document.getElementById("sessionDetailsMeta");
const sessionSenderName = document.getElementById("sessionSenderName");
const senderAvatar = document.getElementById("senderAvatar");
const masterAudioPlayer = document.getElementById("masterAudioPlayer");
const speakerCardsGrid = document.getElementById("speakerCardsGrid");

// Responsive state management
const outlookApp = document.querySelector(".outlook-app");
const btnBackToAgents = document.getElementById("btnBackToAgents");

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
    loadAgents();
    setupEventListeners();
    setupResizers();
    
    // Set initial responsive state
    outlookApp.classList.add("state-agent-list");
});

function setupResizers() {
    const resizer1 = document.getElementById('resizer1');
    const resizer2 = document.getElementById('resizer2');
    const panel1 = document.getElementById('agentListPane');
    const panel2 = document.getElementById('agentDetailsPane');

    let x = 0;
    
    // Resizer 1
    resizer1.addEventListener('mousedown', function(e) {
        x = e.clientX;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', mouseMoveHandler1);
        document.addEventListener('mouseup', mouseUpHandler1);
        resizer1.classList.add('dragging');
    });
    const mouseMoveHandler1 = function(e) {
        const p1Rect = panel1.getBoundingClientRect();
        const p2Rect = panel2.getBoundingClientRect();
        
        // Allowed range for the mouse
        const minX = p1Rect.left + 200; // Panel 1 min width
        const maxX = p2Rect.right - 250; // Panel 2 min width
        
        let clientX = e.clientX;
        if (clientX < minX) clientX = minX;
        if (clientX > maxX) clientX = maxX;

        const dx = clientX - x;
        if (dx !== 0) {
            panel1.style.width = `${p1Rect.width + dx}px`;
            panel2.style.width = `${p2Rect.width - dx}px`;
            panel1.style.flex = "none";
            panel2.style.flex = "none";
            x = clientX;
        }
    };
    const mouseUpHandler1 = function() {
        document.removeEventListener('mousemove', mouseMoveHandler1);
        document.removeEventListener('mouseup', mouseUpHandler1);
        resizer1.classList.remove('dragging');
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
    };

    // Resizer 2
    resizer2.addEventListener('mousedown', function(e) {
        x = e.clientX;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', mouseMoveHandler2);
        document.addEventListener('mouseup', mouseUpHandler2);
        resizer2.classList.add('dragging');
    });
    const mouseMoveHandler2 = function(e) {
        const p2Rect = panel2.getBoundingClientRect();
        
        const minX = p2Rect.left + 250; // Panel 2 min-width
        // Ensure Panel 3 has at least 400px of breathing room on the right
        const maxX = window.innerWidth - 400; 
        
        let clientX = e.clientX;
        if (clientX < minX) clientX = minX;
        if (clientX > maxX) clientX = maxX;

        const dx = clientX - x;
        if (dx !== 0) {
            panel2.style.width = `${p2Rect.width + dx}px`;
            panel2.style.flex = "none";
            x = clientX;
        }
    };
    const mouseUpHandler2 = function() {
        document.removeEventListener('mousemove', mouseMoveHandler2);
        document.removeEventListener('mouseup', mouseUpHandler2);
        resizer2.classList.remove('dragging');
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
    };
}

function setupEventListeners() {
    btnNewAnalysis.addEventListener("click", () => newAnalysisModal.classList.add("open"));
    
    // Bulk Upload Events
    if(btnBulkUpload) {
        btnBulkUpload.addEventListener("click", () => {
            bulkUploadForm.reset();
            selectedBulkFile = null;
            bulkFileInfo.textContent = "Supports .ZIP only";
            bulkFileInfo.style.color = "var(--text-muted)";
            bulkUploadModal.classList.add("open");
        });
    }
    if(bulkModalClose) bulkModalClose.addEventListener("click", () => bulkUploadModal.classList.remove("open"));
    if(bulkDropZone) {
        bulkDropZone.addEventListener("click", () => bulkFileInput.click());
        bulkDropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            bulkDropZone.classList.add("dragover");
        });
        bulkDropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            bulkDropZone.classList.remove("dragover");
        });
        bulkDropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            bulkDropZone.classList.remove("dragover");
            if (e.dataTransfer.files.length > 0) handleBulkFileSelect(e.dataTransfer.files[0]);
        });
    }
    if(bulkFileInput) {
        bulkFileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) handleBulkFileSelect(e.target.files[0]);
        });
    }
    if(bulkUploadForm) {
        bulkUploadForm.addEventListener("submit", (e) => { e.preventDefault(); startBulkAnalysis(); });
    }
    
    if(btnReevaluateSession) {
        btnReevaluateSession.addEventListener("click", reevaluateCurrentSession);
    }
    
    const btnExportSessionPDF = document.getElementById("btnExportSessionPDF");
    if(btnExportSessionPDF) {
        btnExportSessionPDF.addEventListener("click", () => {
            if(!currentSessionId) return;
            const element = document.getElementById('readingPaneContent');
            
            // Unhide transcript and remove scroll for PDF
            const transcriptContainer = document.getElementById("transcriptContentContainer");
            const originalDisplay = transcriptContainer ? transcriptContainer.style.display : "";
            if (transcriptContainer) transcriptContainer.style.display = "block";
            
            const origElementOverflow = element.style.overflowY;
            const origElementHeight = element.style.height;
            element.style.overflowY = "visible";
            element.style.height = "auto";
            
            const opt = {
              margin:       0.5,
              filename:     `Scorecard_${currentSessionId}.pdf`,
              image:        { type: 'jpeg', quality: 0.98 },
              html2canvas:  { scale: 2 },
              jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
            };
            
            html2pdf().set(opt).from(element).save().then(() => {
                if (transcriptContainer) transcriptContainer.style.display = originalDisplay;
                element.style.overflowY = origElementOverflow;
                element.style.height = origElementHeight;
            });
        });
    }

    const btnExportSessionCSV = document.getElementById("btnExportSessionCSV");
    if(btnExportSessionCSV) {
        btnExportSessionCSV.addEventListener("click", () => {
            if(!currentSessionData) return;
            const ev = currentSessionData.stage5_evaluation?.transcript_evaluation || {};
            
            // Build CSV rows
            let csvRows = [];
            csvRows.push(['Metric', 'Value']);
            csvRows.push(['Agent Name', ev.agent_name || '']);
            csvRows.push(['Overall Score', (ev.overall_score_percentage || 0) + '%']);
            
            const cats = ['communication_professionalism', 'technical_accuracy', 'process_adherence', 'customer_experience', 'efficiency_metrics'];
            cats.forEach(cat => {
                if(ev[cat]) {
                    Object.entries(ev[cat]).forEach(([k, v]) => {
                        csvRows.push([k, v]);
                    });
                }
            });
            csvRows.push([]);
            csvRows.push(['Speaker', 'Text']);
            if(currentSessionData.turns) {
                currentSessionData.turns.forEach(t => {
                    csvRows.push([t.speaker, `"${(t.text || '').replace(/"/g, '""')}"`]);
                });
            }
            
            const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Session_${currentSessionId}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    const btnExportAgentPDF = document.getElementById("btnExportAgentPDF");
    if(btnExportAgentPDF) {
        btnExportAgentPDF.addEventListener("click", () => {
            if(!currentAgentName) return;
            const element = document.getElementById('agentDetailsPane');
            const listEl = document.getElementById('agentSessionsList');
            
            // Temporarily remove overflow to capture full list
            const origElementHeight = element.style.height;
            const origListOverflow = listEl ? listEl.style.overflowY : "";
            const origListFlex = listEl ? listEl.style.flex : "";
            
            element.style.height = "auto";
            if (listEl) {
                listEl.style.overflowY = "visible";
                listEl.style.flex = "none";
            }
            
            const opt = {
              margin:       0.5,
              filename:     `AgentReport_${currentAgentName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
              image:        { type: 'jpeg', quality: 0.98 },
              html2canvas:  { scale: 2 },
              jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
            };
            
            html2pdf().set(opt).from(element).save().then(() => {
                element.style.height = origElementHeight;
                if (listEl) {
                    listEl.style.overflowY = origListOverflow;
                    listEl.style.flex = origListFlex;
                }
            });
        });
    }

    const btnExportAgentCSV = document.getElementById("btnExportAgentCSV");
    if(btnExportAgentCSV) {
        btnExportAgentCSV.addEventListener("click", () => {
            if(!currentAgentName || !currentAgentSessionsData) return;
            
            let csvRows = [];
            csvRows.push(['Session ID', 'Topic', 'Date', 'Score', 'Status']);
            
            currentAgentSessionsData.forEach(s => {
                const date = new Date(s.created_at * 1000).toLocaleString().replace(/,/g, '');
                const score = (s.stage5_evaluation?.transcript_evaluation?.overall_score_percentage || 0) + '%';
                csvRows.push([
                    s.session_id, 
                    `"${(s.topic || '').replace(/"/g, '""')}"`, 
                    date, 
                    score, 
                    s.status
                ]);
            });
            
            const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Agent_${currentAgentName.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }
    
    const btnUploadForAgent = document.getElementById("btnUploadForAgent");
    if(btnUploadForAgent) {
        btnUploadForAgent.addEventListener("click", () => {
            newAnalysisModal.classList.add("open");
        });
    }
    
    const btnToggleTranscript = document.getElementById("btnToggleTranscript");
    if(btnToggleTranscript) {
        btnToggleTranscript.addEventListener("click", () => {
            const container = document.getElementById("transcriptContentContainer");
            if(container.style.display === "none") {
                container.style.display = "block";
                btnToggleTranscript.textContent = "Hide Transcript";
            } else {
                container.style.display = "none";
                btnToggleTranscript.textContent = "Show Transcript";
            }
        });
    }
    
    if(btnViewGraphs) {
        btnViewGraphs.addEventListener("click", () => {
            if(currentSessionData) renderCharts(currentSessionData);
            graphsModal.classList.add("open");
        });
    }
    if(graphsModalClose) {
        graphsModalClose.addEventListener("click", () => {
            graphsModal.classList.remove("open");
        });
    }
    modalClose.addEventListener("click", () => {
        newAnalysisModal.classList.remove("open");
        resetForm();
    });

    dropZone.addEventListener("click", () => audioFileInput.click());
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    audioFileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });
    newAnalysisForm.addEventListener("submit", (e) => { e.preventDefault(); startAnalysis(); });

    searchAgents.addEventListener("input", (e) => filterAgents(e.target.value));

    agentDateFilter.addEventListener("change", () => {
        if (currentAgentName) selectAgent(currentAgentName);
    });
    
    document.getElementById("btnDeleteSession").addEventListener("click", deleteCurrentSession);
    
    // Responsive Back Navigation
    if(btnBackToAgents) {
        btnBackToAgents.addEventListener("click", () => {
            outlookApp.classList.remove("state-agent-details", "state-recording-analysis");
            outlookApp.classList.add("state-agent-list");
        });
    }
    
    const btnMobileBack = document.getElementById("btnMobileBack");
    if(btnMobileBack) {
        btnMobileBack.addEventListener("click", () => {
            outlookApp.classList.remove("state-recording-analysis", "state-agent-list");
            outlookApp.classList.add("state-agent-details");
            readingPaneContent.classList.add("hidden");
            emptyState.classList.remove("hidden");
        });
    }
}

function handleFileSelect(file) {
    selectedFile = file;
    fileInfo.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    fileInfo.style.color = "var(--outlook-blue)";
}

function resetForm() {
    newAnalysisForm.reset();
    selectedFile = null;
    fileInfo.textContent = "Supports MP3, WAV, M4A, FLAC";
    fileInfo.style.color = "var(--text-muted)";
}


function handleBulkFileSelect(file) {
    selectedBulkFile = file;
    bulkFileInfo.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    bulkFileInfo.style.color = "var(--outlook-blue)";
}

async function startBulkAnalysis() {
    if (!selectedBulkFile) return alert("Please select a ZIP file.");
    
    const formData = new FormData();
    formData.append("file", selectedBulkFile);
    
    bulkUploadModal.classList.remove("open");
    
    // Use the progress panel for uploading state
    progressPanel.classList.add("open");
    progressMessage.textContent = "Uploading batch ZIP file...";
    progressBarFill.style.width = "50%";
    
    try {
        const response = await fetch("/api/upload/bulk", {
            method: "POST",
            body: formData
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Upload failed");
        }
        
        progressPanel.classList.remove("open");
        alert("Batch uploaded successfully! Pending sessions have been created.");
        loadAgents();
    } catch (e) {
        progressPanel.classList.remove("open");
        alert(e.message);
    }
}

async function reevaluateCurrentSession() {
    if(!currentSessionId) return;
    
    // We need a topic. If current session doesn't have it locally, we just pass the existing one.
    // In our UI, sessionTopic.textContent has it.
    const topic = document.getElementById("sessionTopic").textContent;
    
    const formData = new FormData();
    formData.append("topic", topic);
    
    progressPanel.classList.add("open");
    progressMessage.textContent = "Queueing LLM Re-evaluation...";
    progressBarFill.style.width = "0%";
    progressPercentage.textContent = "0%";
    
    try {
        const response = await fetch(`/api/reevaluate/${currentSessionId}`, {
            method: "POST",
            body: formData
        });
        
        if (response.ok) {
            pollAnalysisStatus(currentSessionId);
        } else {
            throw new Error("Failed to start re-evaluation");
        }
    } catch (e) {
        progressPanel.classList.remove("open");
        alert(e.message);
    }
}

window.runPendingAnalysis = async function(e, sessionId) {
    e.stopPropagation();
    progressPanel.classList.add("open");
    progressMessage.textContent = "Starting analysis for pending session...";
    progressBarFill.style.width = "0%";
    progressPercentage.textContent = "0%";
    
    try {
        const response = await fetch(`/api/analyze/pending/${sessionId}`, {
            method: "POST"
        });
        
        if (response.ok) {
            pollAnalysisStatus(sessionId);
        } else {
            throw new Error("Failed to start analysis");
        }
    } catch (e) {
        progressPanel.classList.remove("open");
        alert(e.message);
    }
};

async function loadAgents() {
    try {
        const res = await fetch("/api/agents");
        const agents = await res.json();
        
        if (agents.length === 0) {
            agentList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No agents found.</div>`;
            return;
        }
        
        agentList.innerHTML = agents.map(agent => `
            <div class="session-item" data-name="${agent.agent_name}" onclick="selectAgent('${agent.agent_name}')">
                <div class="session-item-top">
                    <span class="session-title">${agent.agent_name}</span>
                    <span class="score-badge ${agent.avg_score >= 80 ? 'high' : (agent.avg_score >= 60 ? 'mid' : 'low')}">${agent.avg_score}%</span>
                </div>
                <div class="session-desc" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px;">
                    ${Object.entries(agent.emotion_counts || {}).map(([emo, count]) => {
                        const pct = agent.analyzed_calls > 0 ? Math.round((count / agent.analyzed_calls) * 100) : 0;
                        return `<span style="font-size: 10px; background: var(--bg-hover); padding: 2px 5px; border-radius: 4px;">${emo.charAt(0).toUpperCase() + emo.slice(1)}: ${count} (${pct}%)</span>`;
                    }).join("") || `<span style="font-size: 10px; color: var(--text-secondary);">No emotions</span>`}
                </div>
                <div class="session-meta">
                    <span>${agent.total_calls} calls</span>
                </div>
            </div>
        `).join("");
        
        if (agents.length > 0) {
            const chartCanvas = document.getElementById("allAgentsPerformanceChart");
            if(chartCanvas) {
                if(window.agentsPerfChart) window.agentsPerfChart.destroy();
                const labels = agents.map(a => a.agent_name.length > 10 ? a.agent_name.substring(0, 10) + '...' : a.agent_name);
                const scores = agents.map(a => a.avg_score);
                window.agentsPerfChart = new Chart(chartCanvas, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Avg Score',
                            data: scores,
                            backgroundColor: 'rgba(0, 120, 212, 0.6)',
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { display: false, min: 0, max: 100 },
                            x: { ticks: { font: { size: 10 }, color: '#616161' }, grid: { display: false } }
                        }
                    }
                });
            }
            selectAgent(agents[0].agent_name);
        }
    } catch (e) {
        agentList.innerHTML = '<p class="error-msg">Failed to load agents.</p>';
    }
}

function filterAgents(q) {
    const term = q.toLowerCase();
    agentList.querySelectorAll(".session-item").forEach(el => {
        if (el.querySelector(".session-title").textContent.toLowerCase().includes(term)) {
            el.style.display = "flex";
        } else {
            el.style.display = "none";
        }
    });
}

async function selectAgent(agentName) {
    currentAgentName = agentName;
    selectedAgentName.textContent = agentName;
    
    // Update responsive state
    outlookApp.classList.remove("state-agent-list", "state-recording-analysis");
    outlookApp.classList.add("state-agent-details");
    
    agentList.querySelectorAll(".session-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.name === agentName);
    });

    const days = agentDateFilter.value;
    try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/sessions?days=${days}`);
        const sessions = await res.json();
        
        if (sessions.length === 0) {
            agentSummaryCard.style.display = "none";
            agentSessionsList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No sessions found in this timeframe.</div>`;
            return;
        }

        // Calculate summary
        let totalScore = 0;
        let emotions = {};
        let analyzedCount = 0;
        
        sessions.forEach(s => {
            const ev = s.stage5_evaluation?.transcript_evaluation || {};
            let score = ev.overall_score_percentage || 0;
            totalScore += score;
            
            const agentSpk = ev.agent_speaker_label || "";
            const spkEm = s.stage5_evaluation?.speaker_emotions || {};
            if (agentSpk && spkEm[agentSpk]) {
                const callEmotions = spkEm[agentSpk].all_emotions || {};
                
                // If all_emotions is populated by smallest.ai
                if (Object.keys(callEmotions).length > 0) {
                    analyzedCount++;
                    Object.entries(callEmotions).forEach(([emo, pct]) => {
                        emotions[emo.toLowerCase()] = (emotions[emo.toLowerCase()] || 0) + pct;
                    });
                } else if (spkEm[agentSpk].emotion && spkEm[agentSpk].emotion !== "N/A") {
                    // Fallback to legacy primary emotion if no all_emotions exists
                    analyzedCount++;
                    const e = spkEm[agentSpk].emotion.toLowerCase();
                    emotions[e] = (emotions[e] || 0) + 100;
                }
            }
        });
        
        if (analyzedCount > 0) {
            Object.keys(emotions).forEach(k => {
                emotions[k] = Math.round(emotions[k] / analyzedCount);
            });
        }
        
        const avgScore = totalScore / (sessions.length || 1);
        agentSummaryCalls.textContent = sessions.length;
        agentSummaryScore.textContent = avgScore.toFixed(1) + "%";
        
        let toneText = "No emotional data available from smallest.ai for this timeframe.";
        
        if (analyzedCount > 0 && Object.keys(emotions).length > 0) {
            let sortedEmotions = Object.entries(emotions).sort((a, b) => b[1] - a[1]);
            let emotionParts = sortedEmotions.filter(e => e[1] > 0).map(e => `${e[1]}% ${e[0]}`);
            if(emotionParts.length > 0) {
                let listStr = emotionParts.length > 1 ? emotionParts.slice(0, -1).join(", ") + ", and " + emotionParts[emotionParts.length - 1] : emotionParts[0];
                toneText = `According to smallest.ai aggregated analysis across these calls, ${agentName}'s tone averaged ${listStr}.`;
            }
        }
        
        const toneTextEl = document.getElementById("agentSummaryToneText");
        if (toneTextEl) toneTextEl.textContent = `"${toneText}"`;
        
        agentSummaryCard.style.display = "block";
        currentAgentSessionsData = sessions;
        if (btnExportAgentPDF) btnExportAgentPDF.style.display = "block";
        if (btnExportAgentCSV) btnExportAgentCSV.style.display = "block";

        agentSessionsList.innerHTML = sessions.map(session => {
            const isPending = session.status === "pending";
            const ev = session.stage5_evaluation?.transcript_evaluation || {};
            let score = ev.overall_score_percentage || 0;
            let tier = score >= 80 ? "high" : (score >= 60 ? "mid" : "low");
            
            let badgeHtml = isPending 
                ? `<button class="fluent-btn-primary" style="padding: 2px 8px; font-size: 11px; min-width: auto; height: 22px;" onclick="runPendingAnalysis(event, '${session.session_id}')">Analyze</button>`
                : `<span class="score-badge ${tier}">${score.toFixed(1)}%</span>`;
                
            return `
                <div class="session-item" data-id="${session.session_id}" onclick="selectSession('${session.session_id}')">
                    <div class="session-item-top">
                        <span class="session-title">${session.topic || 'Session'}</span>
                        ${badgeHtml}
                    </div>
                    <div class="session-desc">Score: ${isPending ? 'Pending' : score.toFixed(1) + '%'}</div>
                    <div class="session-meta">
                        <span>ID: ${session.session_id.substring(0,6)}...</span>
                        <span>${new Date(session.created_at * 1000).toLocaleDateString()}</span>
                    </div>
                </div>
            `;
        }).join("");
        
        if (sessions.length > 0) {
            selectSession(sessions[0].session_id);
        }

    } catch (e) {
        agentSessionsList.innerHTML = '<p class="error-msg">Error loading agent sessions.</p>';
    }
}

async function selectSession(sessionId) {
    currentSessionId = sessionId;
    agentSessionsList.querySelectorAll(".session-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.id === sessionId);
    });

    // Update responsive state
    outlookApp.classList.remove("state-agent-list", "state-agent-details");
    outlookApp.classList.add("state-recording-analysis");

    try {
        const response = await fetch(`/api/sessions/${sessionId}`);
        const session = await response.json();
        currentSessionData = session;
        renderSessionReport(session);
    } catch (err) {
        alert("Failed to load session details.");
    }
}

function renderSessionReport(session) {
    if (session.status === "pending") {
        emptyState.classList.remove("hidden");
        readingPaneContent.classList.add("hidden");
        emptyState.innerHTML = `<i class="ms-Icon ms-Icon--Processing" aria-hidden="true" style="font-size: 48px; color: var(--outlook-blue);"></i><h1 style="margin-top: 20px;">Pending Analysis</h1><p>Click the Analyze button in the sessions list to process this recording.</p>`;
        return;
    } else {
        emptyState.innerHTML = `<i class="ms-Icon ms-Icon--Audio" aria-hidden="true"></i><h1>Select a Recording</h1><p>Select a session from the middle panel to view its detailed QA scorecard.</p>`;
        emptyState.classList.add("hidden");
        readingPaneContent.classList.remove("hidden");
    }

    sessionTopic.textContent = session.topic || "Voice Session";
    
    // Master audio player (PII scrubbed)
    masterAudioPlayer.src = `/static/audio/${session.session_id}/beeped_input.wav`;
    
    const ev = session.stage5_evaluation?.transcript_evaluation;
    if (ev) {
        let score = ev.overall_score_percentage || 0;
        document.getElementById("qaOverallScore").textContent = score + "%";
        
        sessionSenderName.textContent = ev.agent_name || "Agent";
        senderAvatar.textContent = (ev.agent_name || "A").substring(0,2).toUpperCase();

        const renderMetric = (label, value, max) => {
            let valNum = (value !== undefined && value !== 'N/A' && value !== null && value !== -1) ? parseInt(value) : -1;
            let displayVal = valNum >= 0 ? `${valNum}/${max}` : 'N/A';
            let pct = valNum >= 0 ? (valNum / max) * 100 : 0;
            let color = pct >= 80 ? 'var(--excel-green)' : (pct >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)');
            if (valNum < 0) color = 'var(--text-muted)';
            
            return `
                <div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                        <span style="color: var(--text-primary); font-weight: 500;">${label}</span>
                        <span style="font-weight: 700; color: ${color};">${displayVal}</span>
                    </div>
                    <div style="height: 6px; background-color: rgba(128, 128, 128, 0.2); border-radius: 4px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);">
                        <div style="height: 100%; width: ${valNum >= 0 ? pct : 0}%; background: linear-gradient(90deg, ${color}, ${color}dd); border-radius: 4px; transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
                    </div>
                </div>
            `;
        };

        const catHTML = `
            <div class="scorecard-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; margin-top: 20px;">
                
                <!-- Communication & Professionalism -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--Message" aria-hidden="true" style="font-size: 18px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 600;">Communication & Professionalism</h4>
                    </div>
                    ${renderMetric('Greeting & Verification', ev.communication_professionalism?.greeting_verification, 5)}
                    ${renderMetric('Active Listening & Empathy', ev.communication_professionalism?.active_listening_empathy, 5)}
                    ${renderMetric('Probing the Issue', ev.communication_professionalism?.probing_issue, 5)}
                    ${renderMetric('Validating Priority', ev.communication_professionalism?.validating_priority, 5)}
                </div>

                <!-- Technical Accuracy & Resolution -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #107c41, #84c99c);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(16, 124, 65, 0.1); display: flex; align-items: center; justify-content: center; color: #107c41;">
                            <i class="ms-Icon ms-Icon--Repair" aria-hidden="true" style="font-size: 18px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 600;">Technical Accuracy</h4>
                    </div>
                    ${renderMetric('Accurate Troubleshooting', ev.technical_accuracy?.accurate_troubleshooting, 10)}
                    ${renderMetric('Solution Accuracy', ev.technical_accuracy?.solution_accuracy, 10)}
                    ${renderMetric('Valid Escalation', ev.technical_accuracy?.valid_escalation, 5)}
                    ${renderMetric('Knowledge Base Use', ev.technical_accuracy?.knowledge_base_use, 5)}
                </div>
                
                <!-- Process Adherence -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #6264a7, #a6a9e1);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(98, 100, 167, 0.1); display: flex; align-items: center; justify-content: center; color: #6264a7;">
                            <i class="ms-Icon ms-Icon--ComplianceAsset" aria-hidden="true" style="font-size: 18px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 600;">Process Adherence</h4>
                    </div>
                    ${renderMetric('Critical/P1 Compliance', ev.process_adherence?.critical_compliance, 5)}
                    ${renderMetric('Ticket Documentation', ev.process_adherence?.ticket_documentation, 10)}
                    ${renderMetric('Time Entry & Agreement', ev.process_adherence?.time_entry_agreement, 5)}
                </div>
                
                <!-- Customer Experience -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #ffb900, #ffe285);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(255, 185, 0, 0.1); display: flex; align-items: center; justify-content: center; color: #ffb900;">
                            <i class="ms-Icon ms-Icon--Heart" aria-hidden="true" style="font-size: 18px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 600;">Customer Experience</h4>
                    </div>
                    ${renderMetric('Ownership of Incident', ev.customer_experience?.incident_ownership, 5)}
                    ${renderMetric('Stakeholder Communication', ev.customer_experience?.stakeholder_communication, 10)}
                    ${renderMetric('Proper Closing & Satisfaction', ev.customer_experience?.proper_closing_satisfaction, 5)}
                </div>
                
                <!-- Efficiency Metrics -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #d13438, #ff8c8f);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(209, 52, 56, 0.1); display: flex; align-items: center; justify-content: center; color: #d13438;">
                            <i class="ms-Icon ms-Icon--SpeedHigh" aria-hidden="true" style="font-size: 18px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 600;">Efficiency</h4>
                    </div>
                    ${renderMetric('First Call Resolution', ev.efficiency_metrics?.first_call_resolution, 5)}
                    ${renderMetric('30 Minute Rule', ev.efficiency_metrics?.thirty_minute_rule, 3)}
                    ${renderMetric('Minimal Transfers/Holds', ev.efficiency_metrics?.minimal_transfers_holds, 2)}
                </div>
                
                <!-- Reviewer Feedback -->
                <div class="scorecard-section" style="grid-column: 1 / -1; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 26px; box-shadow: 0 8px 32px rgba(0,0,0,0.06); display: flex; flex-direction: column; gap: 18px; margin-top: 10px; position: relative;">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 4px; background: linear-gradient(to right, #0078d4, #107c41, #ffb900);"></div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 20px; background: linear-gradient(135deg, #0078d4, #84c99c); display: flex; align-items: center; justify-content: center; color: white;">
                            <i class="ms-Icon ms-Icon--Feedback" aria-hidden="true" style="font-size: 18px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">AI Reviewer Feedback</h4>
                    </div>
                    <div style="font-size: 14px; line-height: 1.7; color: var(--text-primary); background: rgba(128,128,128,0.05); padding: 20px; border-radius: 10px; border-left: 4px solid #0078d4; font-style: italic;">
                        "${ev.technical_reviewer_feedback || 'No actionable feedback provided for this session.'}"
                    </div>
                </div>

            </div>
        `;
        document.getElementById("qaCategoriesContainer").innerHTML = catHTML;
    }

    if (speakerCardsGrid) speakerCardsGrid.innerHTML = "";
    
    const transcriptContainer = document.getElementById("transcriptContentContainer");
    if(transcriptContainer && session.turns) {
        transcriptContainer.innerHTML = session.turns.map(t => {
            const color = t.speaker.includes('00') ? 'var(--outlook-blue)' : 'var(--text-primary)';
            return `<div style="margin-bottom: 12px;">
                <strong style="color: ${color};">${t.speaker}:</strong> 
                <span style="color: var(--text-primary);">${t.text}</span>
            </div>`;
        }).join('');
        
        // Reset toggle button
        const btnToggleTranscript = document.getElementById("btnToggleTranscript");
        if(btnToggleTranscript) {
            btnToggleTranscript.textContent = "Show Transcript";
            transcriptContainer.style.display = "none";
        }
    } else if(transcriptContainer) {
        transcriptContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center;">No transcript available for this session.</div>';
    }
}

// Chart.js render logic
let qaRadarChartInstance = null;
let emotionPolarChartInstance = null;

function renderCharts(session) {
    const ev = session.stage5_evaluation?.transcript_evaluation;
    if(!ev) return;
    
    // Aggregate category scores
    const commScore = (ev.communication_professionalism?.greeting_verification || 0) + 
                      (ev.communication_professionalism?.active_listening_empathy || 0) + 
                      (ev.communication_professionalism?.probing_issue || 0) + 
                      (ev.communication_professionalism?.validating_priority || 0);
                      
    const techScore = (ev.technical_accuracy?.accurate_troubleshooting || 0) + 
                      (ev.technical_accuracy?.solution_accuracy || 0) + 
                      (ev.technical_accuracy?.valid_escalation || 0); // Exclude KB which is N/A
                      
    const procScore = (ev.process_adherence?.critical_compliance || 0) + 
                      (ev.process_adherence?.ticket_documentation || 0) + 
                      (ev.process_adherence?.time_entry_agreement || 0);
                      
    const custScore = (ev.customer_experience?.incident_ownership || 0) + 
                      (ev.customer_experience?.stakeholder_communication || 0) + 
                      (ev.customer_experience?.proper_closing_satisfaction || 0);
                      
    const effScore  = (ev.efficiency_metrics?.first_call_resolution || 0) + 
                      (ev.efficiency_metrics?.thirty_minute_rule || 0) + 
                      (ev.efficiency_metrics?.minimal_transfers_holds || 0);

    const qaData = {
        labels: ['Communication', 'Tech Accuracy', 'Process', 'Customer Exp', 'Efficiency'],
        datasets: [{
            label: 'Agent Score %',
            data: [
                (commScore / 20) * 100,
                (techScore / 25) * 100, // 25 because KB is -1
                (procScore / 20) * 100,
                (custScore / 20) * 100,
                (effScore / 10) * 100
            ],
            backgroundColor: 'rgba(0, 120, 212, 0.2)',
            borderColor: '#0078d4',
            pointBackgroundColor: '#107c41',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#107c41',
            borderWidth: 2,
            fill: true
        }]
    };

    if (qaRadarChartInstance) qaRadarChartInstance.destroy();
    qaRadarChartInstance = new Chart(document.getElementById('qaRadarChart'), {
        type: 'radar',
        data: qaData,
        options: {
            scales: {
                r: {
                    angleLines: { color: 'rgba(128,128,128,0.2)' },
                    grid: { color: 'rgba(128,128,128,0.2)' },
                    pointLabels: { font: { size: 11, family: 'Outfit' }, color: '#616161' },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            },
            plugins: { legend: { display: false } },
            elements: { line: { tension: 0.3 } }
        }
    });

    // Emotion Polar Area Chart
    const agentSpk = ev.agent_speaker_label;
    const emotions = session.stage5_evaluation?.speaker_emotions || {};
    
    let emotionCounts = {};
    if (agentSpk && emotions[agentSpk] && emotions[agentSpk].all_emotions && Object.keys(emotions[agentSpk].all_emotions).length > 0) {
        // Use detailed smallest.ai emotions for the agent
        emotionCounts = emotions[agentSpk].all_emotions;
    } else {
        // Fallback or empty if smallest.ai failed
        emotionCounts = { 'Neutral': 0, 'Frustrated': 0, 'Happy': 0, 'Sad': 0, 'Angry': 0 };
        Object.values(emotions).forEach(e => {
            let em = (e.emotion || 'neutral').toLowerCase();
            em = em.charAt(0).toUpperCase() + em.slice(1);
            if (emotionCounts[em] !== undefined) emotionCounts[em]++;
            else emotionCounts[em] = 1;
        });
    }
    
    let labels = [];
    let dataCounts = [];
    let colors = [];
    
    Object.keys(emotionCounts).forEach(k => {
        let val = emotionCounts[k];
        if (val > 0) {
            labels.push(k);
            dataCounts.push(val);
            
            const keyLower = k.toLowerCase();
            if(keyLower.includes('neutral')) colors.push('rgba(200, 200, 200, 0.7)');
            else if(keyLower.includes('frustrat') || keyLower.includes('anger') || keyLower.includes('angry')) colors.push('rgba(209, 52, 56, 0.7)');
            else if(keyLower.includes('happy') || keyLower.includes('happiness')) colors.push('rgba(16, 124, 65, 0.7)');
            else if(keyLower.includes('sad') || keyLower.includes('sadness')) colors.push('rgba(0, 120, 212, 0.7)');
            else colors.push('rgba(98, 100, 167, 0.7)');
        }
    });

    if (emotionPolarChartInstance) emotionPolarChartInstance.destroy();
    emotionPolarChartInstance = new Chart(document.getElementById('emotionPolarChart'), {
        type: 'polarArea',
        data: {
            labels: labels,
            datasets: [{
                data: dataCounts,
                backgroundColor: colors,
                borderWidth: 1
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom', labels: { font: { family: 'Outfit' } } }
            }
        }
    });
}

// Upload & Poll Logic
async function startAnalysis() {
    if (!selectedFile) return alert("Select audio file.");
    const topic = selectedFile.name.replace(/\.[^/.]+$/, "");
    newAnalysisModal.classList.remove("open");
    progressPanel.classList.add("open");
    updateProgressBar("Queueing audio file analysis task...", 5);
    
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("topic", topic);

    try {
        const response = await fetch("/api/analyze", { method: "POST", body: formData });
        const data = await response.json();
        pollAnalysisStatus(data.session_id);
    } catch (err) {
        progressPanel.classList.remove("open");
        alert("Failed to start analysis");
    }
}

function pollAnalysisStatus(sessionId) {
    if (activePollInterval) clearInterval(activePollInterval);
    activePollInterval = setInterval(async () => {
        const response = await fetch(`/api/status/${sessionId}`);
        const task = await response.json();
        if (task.status === "processing" || task.status === "pending") {
            updateProgressBar(task.progress_message, task.progress_percent);
        } else if (task.status === "success") {
            clearInterval(activePollInterval);
            updateProgressBar("Complete", 100);
            
            // Extract agent name from the result
            const ev = task.result?.stage5_evaluation?.transcript_evaluation || {};
            const agentName = ev.agent_name || "Unknown Agent";
            
            setTimeout(async () => {
                progressPanel.classList.remove("open");
                resetForm();
                await loadAgents(); // refresh agents
                await selectAgent(agentName);
                await selectSession(sessionId);
            }, 800);
        } else if (task.status === "failed") {
            clearInterval(activePollInterval);
            progressPanel.classList.remove("open");
            alert("Analysis failed.");
        }
    }, 2000);
}

function updateProgressBar(msg, pct) {
    progressMessage.textContent = msg;
    progressBarFill.style.width = `${pct}%`;
    progressPercentage.textContent = `${pct}%`;
}

async function deleteCurrentSession() {
    if (!currentSessionId) return;
    if (confirm("Delete this session?")) {
        await fetch(`/api/sessions/${currentSessionId}`, { method: "DELETE" });
        readingPaneContent.classList.add("hidden");
        emptyState.classList.remove("hidden");
        if (currentAgentName) selectAgent(currentAgentName); // reload current agent's sessions
    }
}
