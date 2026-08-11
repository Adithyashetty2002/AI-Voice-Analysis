// Outlook Voice Analytics Frontend controller

let currentAgentName = null;
let currentAgentId = null;
let currentSessionId = null;
let activePollInterval = null;
let selectedFiles = [];

let uiColors = {
    excellent: "#107c41", 
    good: "#0078d4",
    needsImprovement: "#d13438",
    na: "#ffb900"
};

let scoreThresholds = {
    excellent: 90,
    good: 75
};

let targetBenchmark = 85;

async function loadUiConfig() {
    try {
        const res = await fetch("/api/ui-config");
        if (res.ok) {
            const data = await res.json();
            uiColors.excellent = data.colorExcellent || uiColors.excellent;
            uiColors.good = data.colorGood || uiColors.good;
            uiColors.needsImprovement = data.colorNeedsImprovement || uiColors.needsImprovement;
            uiColors.na = data.colorNA || uiColors.na;
            scoreThresholds.excellent = data.scoreThresholdExcellent || scoreThresholds.excellent;
            scoreThresholds.good = data.scoreThresholdGood || scoreThresholds.good;
            targetBenchmark = data.targetBenchmark || targetBenchmark;
        }
    } catch (e) {
        console.error("Failed to load UI config:", e);
    }
}

function getScoreBgColor(score, isNa = false) {
    if (isNa) return uiColors.na;
    if (score >= scoreThresholds.excellent) return uiColors.excellent;
    if (score >= scoreThresholds.good) return uiColors.good;
    return uiColors.needsImprovement;
}

function showToast(message, isError = false) {
    const toast = document.getElementById("toastNotification");
    if (!toast) return;
    toast.textContent = message;
    toast.style.backgroundColor = isError ? "#d83b01" : "#107c41"; // Fluent red vs green
    toast.style.visibility = "visible";
    toast.style.opacity = "1";
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.style.visibility = "hidden", 500);
    }, 3000);
}

let confirmCallback = null;
function showConfirm(message, callback) {
    const modal = document.getElementById("confirmModal");
    const msgEl = document.getElementById("confirmModalMessage");
    if (!modal || !msgEl) {
        // Fallback if HTML is missing
        if(confirm(message)) callback();
        return;
    }
    msgEl.textContent = message;
    confirmCallback = callback;
    modal.classList.add("open");
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadUiConfig();
    
    const btnCancel = document.getElementById("btnConfirmCancel");
    const btnProceed = document.getElementById("btnConfirmProceed");
    const modal = document.getElementById("confirmModal");
    if(btnCancel) {
        btnCancel.addEventListener("click", () => {
            modal.classList.remove("open");
            confirmCallback = null;
        });
    }
    if(btnProceed) {
        btnProceed.addEventListener("click", () => {
            modal.classList.remove("open");
            if(confirmCallback) confirmCallback();
            confirmCallback = null;
        });
    }
});

// --- DOM Elements ---
const btnFilterAgent = document.getElementById("btnFilterAgent");
const agentsModal = document.getElementById("agentsModal");
const agentsModalClose = document.getElementById("agentsModalClose");

const emailComposeModal = document.getElementById("emailComposeModal");
const emailComposeModalClose = document.getElementById("emailComposeModalClose");
const emailComposeForm = document.getElementById("emailComposeForm");
const emailComposeTo = document.getElementById("emailComposeTo");
const emailComposeSubject = document.getElementById("emailComposeSubject");
const emailComposeBody = document.getElementById("emailComposeBody");
const btnSendEmailSubmit = document.getElementById("btnSendEmailSubmit");

function hideForPDF(element) {
    const toHide = element.querySelectorAll('.reading-toolbar, .toolbar-btn, button');
    const originalStyles = [];
    toHide.forEach(el => {
        originalStyles.push({ el, display: el.style.display });
        el.style.display = 'none';
    });
    return originalStyles;
}

function restoreForPDF(originalStyles) {
    originalStyles.forEach(item => {
        item.el.style.display = item.display;
    });
}

function populatePDFTemplate(sessionData, agentName) {
    if (!sessionData) return null;
    const ev = sessionData.stage5_evaluation?.transcript_evaluation || {};
    
    const sessionListItem = window.globalAgentsList?.find(a => a.agent_id === currentAgentId) ? 
        currentAgentSessionsData?.find(s => s.session_id === sessionData.session_id) : null;
    
    let dateStr = new Date().toLocaleString();
    if (sessionListItem && sessionListItem.created_at) {
        dateStr = new Date(sessionListItem.created_at * 1000).toLocaleString();
    }
    
    document.getElementById('pdfSessionDate').textContent = dateStr;
    document.getElementById('pdfAgentName').textContent = agentName || "Unknown Agent";
    const overallScore = ev.overall_score_percentage || 0;
    document.getElementById('pdfOverallScore').textContent = overallScore + '%';
    document.getElementById('pdfOverallScore').style.color = getScoreBgColor(overallScore);
    document.getElementById('pdfSessionTopic').textContent = sessionData.displayTitle || "Voice Session";
    
    const sumCat = (cat) => {
        if (!cat) return 0;
        return Object.values(cat).reduce((sum, val) => {
            let num = parseInt(val);
            return sum + (isNaN(num) || num < 0 ? 0 : num);
        }, 0);
    };

    // Build Category Breakdown
    const categories = [
        { key: 'communication_professionalism', title: 'Communication & Professionalism', max: 20 },
        { key: 'technical_accuracy', title: 'Technical Accuracy', max: 30 },
        { key: 'process_adherence', title: 'Process Adherence', max: 20 },
        { key: 'customer_experience', title: 'Customer Experience', max: 20 },
        { key: 'efficiency_metrics', title: 'Efficiency Metrics', max: 10 }
    ];

    let categoryHtml = '';
    categories.forEach(cat => {
        const catData = ev[cat.key];
        const catScore = sumCat(catData);
        
        categoryHtml += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; border: 1px solid #e0e0e0; border-radius: 4px; overflow: hidden;">
            <tr style="background: #f4f4f4;">
                <td style="padding: 12px; font-weight: bold; border-bottom: 1px solid #e0e0e0; width: 80%; word-wrap: break-word;">${cat.title}</td>
                <td style="padding: 12px; font-weight: bold; text-align: right; border-bottom: 1px solid #e0e0e0; width: 20%;">${catScore}/${cat.max}</td>
            </tr>`;
        
        if (catData) {
            Object.entries(catData).forEach(([metricKey, metricVal]) => {
                const metricTitle = metricKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                let displayVal = metricVal;
                let maxSub = 5;
                if (cat.key === 'technical_accuracy' && (metricKey === 'accurate_troubleshooting' || metricKey === 'solution_accuracy') || metricKey === 'ticket_documentation' || metricKey === 'stakeholder_communication') {
                    maxSub = 10;
                }
                if (cat.key === 'efficiency_metrics') {
                    if (metricKey === 'thirty_minute_rule') maxSub = 3;
                    if (metricKey === 'minimal_transfers_holds') maxSub = 2;
                }
                
                if (metricVal < 0) displayVal = 'N/A';
                else displayVal = `${metricVal}/${maxSub}`;

                categoryHtml += `<tr>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; width: 80%; word-wrap: break-word;">${metricTitle}</td>
                    <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee; width: 20%;">${displayVal}</td>
                </tr>`;
            });
        }
        categoryHtml += `</table>`;
    });
    document.getElementById('pdfCategoryBreakdownContainer').innerHTML = categoryHtml;
    
    document.getElementById('pdfReviewerFeedback').textContent = ev.technical_reviewer_feedback || "No feedback provided.";

    const emotionList = document.getElementById('pdfEmotionList');
    const speakerEmotionsRaw = sessionData.stage5_evaluation?.speaker_emotions || {};
    let emotionRowsHtml = '';
    
    Object.keys(speakerEmotionsRaw).forEach(spk => {
        let sessionEmotionCounts = {};
        if (speakerEmotionsRaw[spk].all_emotions && Object.keys(speakerEmotionsRaw[spk].all_emotions).length > 0) {
            sessionEmotionCounts = speakerEmotionsRaw[spk].all_emotions;
        } else {
            let em = (speakerEmotionsRaw[spk].emotion || 'neutral').toLowerCase();
            sessionEmotionCounts[em] = 100;
        }
        
        if (Object.keys(sessionEmotionCounts).length > 0) {
            const sortedEmotions = Object.entries(sessionEmotionCounts).sort((a, b) => b[1] - a[1]);
            const spkLabel = spk === (ev.agent_speaker_label || "Agent") ? "Agent" : "Customer";
            emotionRowsHtml += `<tr><td style="padding: 12px; border: 1px solid #e0e0e0; background: #f9f9f9; font-weight: bold;" colspan="2">${spkLabel} (${spk})</td></tr>`;
            emotionRowsHtml += sortedEmotions.map(([emo, pct]) => {
                const capEmo = emo.charAt(0).toUpperCase() + emo.slice(1);
                return `
                    <tr>
                        <td style="padding: 12px; border: 1px solid #e0e0e0; padding-left: 20px; width: 80%;">${capEmo}</td>
                        <td style="padding: 12px; border: 1px solid #e0e0e0; text-align: center; width: 20%;">${Math.round(pct * 10)}%</td>
                    </tr>
                `;
            }).join('');
        }
    });
    
    if (emotionRowsHtml) {
        emotionList.innerHTML = emotionRowsHtml;
    } else {
        emotionList.innerHTML = `<tr><td style="padding: 12px; border: 1px solid #e0e0e0; font-style: italic; color: #666;" colspan="2">No emotion data available</td></tr>`;
    }
    
    const transcriptContainer = document.getElementById('pdfTranscriptContainer');
    if (sessionData.turns && sessionData.turns.length > 0) {
        const ev = sessionData.stage5_evaluation?.transcript_evaluation || {};
        const agentSpk = ev.agent_speaker_label || "SPEAKER_00";
        
        let htmlContent = sessionData.turns.map(t => {
            const isAgent = t.speaker === agentSpk;
            const bgColor = isAgent ? '#f0f8ff' : '#faf9f8';
            const borderColor = isAgent ? '#d0e8f2' : '#eee';
            const titleColor = isAgent ? '#0078d4' : '#333';
            const displayName = isAgent ? 'Agent' : 'Customer';
            return `<div style="margin-bottom: 15px; padding: 15px; border: 1px solid ${borderColor}; border-radius: 8px; background-color: ${bgColor}; page-break-inside: avoid; word-wrap: break-word;">
                <strong style="color: ${titleColor}; display: block; margin-bottom: 8px;">${displayName}</strong> 
                <div style="color: #333; line-height: 1.5; white-space: pre-wrap;">${t.text}</div>
            </div>`;
        }).join('');
        
        transcriptContainer.innerHTML = htmlContent;
    } else {
        transcriptContainer.innerHTML = '<div style="color: #666; font-style: italic;">No transcript available.</div>';
    }
    
    return document.getElementById('pdfExportTemplate');
}

function populateAgentPDFTemplate(agentData, sessions) {
    if (!agentData || !sessions) return null;
    
    document.getElementById('pdfAgentReportDate').textContent = new Date().toLocaleString();
    document.getElementById('pdfAgentReportName').textContent = agentData.agent_name || "Unknown Agent";
    
    let totalScore = 0;
    
    const completedSessions = sessions.filter(s => s.status !== "pending");
    
    completedSessions.forEach(s => {
        const ev = s.stage5_evaluation?.transcript_evaluation || {};
        totalScore += (ev.overall_score_percentage || 0);
    });
    
    const avgScore = (totalScore / completedSessions.length) || 0;
    document.getElementById('pdfAgentReportScore').textContent = avgScore.toFixed(1) + '%';
    document.getElementById('pdfAgentReportScore').style.color = getScoreBgColor(avgScore);
    document.getElementById('pdfAgentReportCalls').textContent = completedSessions.length;
    
    if (typeof qaRadarChartInstance !== 'undefined' && qaRadarChartInstance) {
        document.getElementById('pdfAgentChartRadar').src = qaRadarChartInstance.toBase64Image();
        document.getElementById('pdfAgentChartRadar').style.display = 'block';
    }
    if (typeof performanceDistributionChartInstance !== 'undefined' && performanceDistributionChartInstance) {
        document.getElementById('pdfAgentChartDoughnut').src = performanceDistributionChartInstance.toBase64Image();
        document.getElementById('pdfAgentChartDoughnut').style.display = 'block';
    }
    if (typeof topImprovementAreasChartInstance !== 'undefined' && topImprovementAreasChartInstance) {
        document.getElementById('pdfAgentChartBar').src = topImprovementAreasChartInstance.toBase64Image();
        document.getElementById('pdfAgentChartBar').style.display = 'block';
    }
    
    const sessionsList = document.getElementById('pdfAgentReportSessionsList');
    sessionsList.innerHTML = completedSessions.map(s => {
        const d = new Date(s.created_at * 1000).toLocaleDateString();
        const score = (s.stage5_evaluation?.transcript_evaluation?.overall_score_percentage || 0).toFixed(1) + "%";
        return `
            <tr>
                <td style="padding: 10px; border: 1px solid #ddd;">${d}</td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${score}</td>
            </tr>
        `;
    }).join('');
    
    return document.getElementById('pdfAgentExportTemplate');
}

// DOM Elements
const btnNewAnalysis = document.getElementById("btnNewAnalysis");
const unifiedUploadModal = document.getElementById("unifiedUploadModal");
const modalClose = document.getElementById("modalClose");








let selectedBulkFile = null;

let currentSessionData = null;
const addAgentModal = document.getElementById("addAgentModal");
const addAgentModalClose = document.getElementById("addAgentModalClose");
const editAgentModal = document.getElementById("editAgentModal");
const editAgentModalClose = document.getElementById("editAgentModalClose");
const editAgentForm = document.getElementById("editAgentForm");

const navAnalytics = document.getElementById("navAnalytics");
const navMail = document.getElementById("navMail");

const btnExportAgentPDF = document.getElementById("btnExportAgentPDF");
const btnExportAgentCSV = document.getElementById("btnExportAgentCSV");
const btnExportSessionPDF = document.getElementById("btnExportSessionPDF");
const btnExportSessionCSV = document.getElementById("btnExportSessionCSV");
const btnDraftEmail = document.getElementById("btnDraftEmail");
let currentAgentSessionsData = [];

const btnReevaluateSession = document.getElementById("btnReevaluateSession");

const unifiedUploadForm = document.getElementById("unifiedUploadForm");
const audioFileInput = document.getElementById("audioFileInput");
const dropZone = document.getElementById("dropZone");
const fileInfo = document.getElementById("fileInfo");
const analysisAgentName = document.getElementById("analysisAgentName");
const progressPanel = document.getElementById("progressPanel");
const progressMessage = document.getElementById("progressMessage");
const progressBarFill = document.getElementById("progressBarFill");
const progressPercentage = document.getElementById("progressPercentage");
const searchAgents = document.getElementById("searchAgents");
const agentList = document.getElementById("agentList");
const agentDepartmentFilter = document.getElementById("agentDepartmentFilter");
const customDepartmentContainer = document.getElementById("customDepartmentContainer");
const customDepartmentInput = document.getElementById("customDepartmentInput");
const btnApplyCustomDepartment = document.getElementById("btnApplyCustomDepartment");

const agentDetailsPane = document.getElementById("agentDetailsPane");
const selectedAgentName = document.getElementById("selectedAgentName");
const agentDateFilter = document.getElementById("agentDateFilter");
const sessionSortFilter = document.getElementById("sessionSortFilter");
const customDateRangeContainer = document.getElementById("customDateRangeContainer");
const customStartDate = document.getElementById("customStartDate");
const customEndDate = document.getElementById("customEndDate");
const btnApplyCustomDate = document.getElementById("btnApplyCustomDate");
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
    if(btnAddAgent) btnAddAgent.addEventListener("click", () => addAgentModal.classList.add("open"));
    if(addAgentModalClose) addAgentModalClose.addEventListener("click", () => addAgentModal.classList.remove("open"));
    if(addAgentForm) {
        addAgentForm.addEventListener("submit", (e) => {
            e.preventDefault();
            submitNewAgent();
        });
    }

    if(editAgentModalClose) editAgentModalClose.addEventListener("click", () => editAgentModal.classList.remove("open"));
    if(editAgentForm) {
        editAgentForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitEditAgent();
        });
    }

    // Close modals on background click
    window.addEventListener("click", (e) => {
        if (e.target === addAgentModal) addAgentModal.classList.remove("open");
        if (e.target === editAgentModal) editAgentModal.classList.remove("open");
        if (typeof unifiedUploadModal !== 'undefined' && e.target === unifiedUploadModal) unifiedUploadModal.classList.remove("open");
        if (typeof emailComposeModal !== 'undefined' && e.target === emailComposeModal) emailComposeModal.classList.remove("open");
        if (typeof analyticsModal !== 'undefined' && e.target === analyticsModal) analyticsModal.classList.remove("open");
    });


    if(bulkAgentsDropZone) {
        bulkAgentsDropZone.addEventListener("click", () => bulkAgentsFileInput.click());
        bulkAgentsDropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            bulkAgentsDropZone.classList.add("dragover");
        });
        bulkAgentsDropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            bulkAgentsDropZone.classList.remove("dragover");
        });
        bulkAgentsDropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            bulkAgentsDropZone.classList.remove("dragover");
            if (e.dataTransfer.files.length > 0) {
                selectedBulkFile = e.dataTransfer.files[0];
                bulkAgentsFileInfo.textContent = selectedBulkFile.name;
                bulkAgentsFileInfo.style.color = "var(--outlook-blue)";
            }
        });
    }
    if(bulkAgentsFileInput) {
        bulkAgentsFileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) {
                selectedBulkFile = e.target.files[0];
                bulkAgentsFileInfo.textContent = selectedBulkFile.name;
                bulkAgentsFileInfo.style.color = "var(--outlook-blue)";
            }
        });
    }
    if(bulkAddAgentsForm) {
        bulkAddAgentsForm.addEventListener("submit", (e) => { e.preventDefault(); startBulkAddAgents(); });
    }

    if(btnUnifiedUpload) {
        btnUnifiedUpload.addEventListener("click", () => {
            unifiedUploadForm.reset();
            selectedFiles = [];
            document.getElementById('audioFileInput').accept = 'audio/*';
            document.getElementById('audioFileInput').multiple = true;
            document.getElementById('dropZoneLabel').innerHTML = 'Drag and drop your audio files here or <span>browse files</span>';
            fileInfo.textContent = "Supports MP3, WAV, FLAC";
            fileInfo.style.color = "var(--text-muted)";
            analysisAgentName.value = currentAgentName || "";
            analysisAgentName.dataset.id = currentAgentId || "";
            unifiedUploadModal.classList.add("open");
        });
    }
    if(modalClose) modalClose.addEventListener("click", () => unifiedUploadModal.classList.remove("open"));
    
    if(btnReevaluateSession) {
        btnReevaluateSession.addEventListener("click", reevaluateCurrentSession);
    }
    
    // removed redeclaration of btnExportSessionPDF
    if(btnExportSessionPDF) {
        btnExportSessionPDF.addEventListener("click", () => {
            if(!currentSessionId) return;
            const element = populatePDFTemplate(currentSessionData, currentAgentName);
            if (!element) return showToast("No session data available.", true);
            
            element.style.display = "block";
            
            const opt = {
              margin:       0.5,
              filename:     `Scorecard_${currentSessionId}.pdf`,
              image:        { type: 'jpeg', quality: 0.98 },
              html2canvas:  { scale: 1 },
              jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
              pagebreak:    { mode: ['css', 'legacy'] }
            };
            
            html2pdf().set(opt).from(element).save().then(() => {
                element.style.display = "none";
            });
        });
    }

    // removed redeclaration of btnExportSessionCSV
    if(btnDraftEmail) {
        btnDraftEmail.addEventListener("click", () => {
            if(!currentSessionData) return;
            const ev = currentSessionData.stage5_evaluation?.transcript_evaluation || {};
            
            // currentAgentId is the agent's email address
            const agentEmail = currentAgentId; 
            const subject = encodeURIComponent(`Performance Review & Feedback - ${currentSessionData.displayTitle || currentSessionData.session_id}`);
            
            const bodyText = `Hi ${currentAgentName},

Here is the feedback and analysis for your recent call (${currentSessionData.displayTitle || currentSessionData.session_id}):

OVERALL SCORE: ${ev.overall_score_percentage || 0}%

FEEDBACK:
${ev.technical_reviewer_feedback || 'No actionable feedback provided for this session.'}

Please review this feedback and let us know if you have any questions.

Best regards,
Management`;

            emailComposeTo.value = agentEmail;
            emailComposeSubject.value = decodeURIComponent(subject);
            emailComposeBody.value = bodyText;
            
            emailComposeModal.classList.add("open");
        });
    }

    if (emailComposeModalClose) {
        emailComposeModalClose.addEventListener("click", () => {
            emailComposeModal.classList.remove("open");
        });
    }

    if (emailComposeForm) {
        emailComposeForm.addEventListener("submit", (e) => {
            e.preventDefault();
            
            const btn = btnSendEmailSubmit;
            const originalBtnHtml = btn.innerHTML;
            btn.innerHTML = '<i class="ms-Icon ms-Icon--Sync" aria-hidden="true" style="animation: spin 1s linear infinite;"></i> Sending...';
            btn.disabled = true;

            const element = populatePDFTemplate(currentSessionData, currentAgentName);
            if (!element) {
                btn.innerHTML = originalBtnHtml;
                btn.disabled = false;
                return showToast("No session data available.", true);
            }
            
            element.style.display = "block";
            
            const opt = {
              margin:       0.5,
              filename:     `Scorecard_${currentSessionId}.pdf`,
              image:        { type: 'jpeg', quality: 0.98 },
              html2canvas:  { scale: 1 },
              jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
              pagebreak:    { mode: ['css', 'legacy'] }
            };
            
            html2pdf().set(opt).from(element).outputPdf('blob').then(async (pdfBlob) => {
                element.style.display = "none";

                const formData = new FormData();
                formData.append("to_email", emailComposeTo.value);
                formData.append("subject", emailComposeSubject.value);
                formData.append("body", emailComposeBody.value);
                formData.append("pdf_file", pdfBlob, `Scorecard_${currentSessionId}.pdf`);

                try {
                    const response = await fetch("/api/send_email", {
                        method: "POST",
                        body: formData
                    });

                    if (response.ok) {
                        showToast("Email sent successfully!");
                        emailComposeModal.classList.remove("open");
                    } else {
                        const errorData = await response.json();
                        showToast(`Failed to send email: ${errorData.detail || 'Unknown error'}`, true);
                    }
                } catch (error) {
                    showToast(`Error sending email: ${error}`, true);
                } finally {
                    btn.innerHTML = originalBtnHtml;
                    btn.disabled = false;
                }
            }).catch(err => {
                console.error("PDF generation error:", err);
                showToast("Failed to generate PDF attachment.", true);
                btn.innerHTML = originalBtnHtml;
                btn.disabled = false;
                element.style.display = "none";
            });
        });
    }
    // btnExportSessionCSV removed
    // removed redeclaration of btnExportAgentPDF
    if(btnExportAgentPDF) {
        btnExportAgentPDF.addEventListener("click", () => {
            if(!currentAgentName || !currentAgentSessionsData) return;
            
            const agent = window.globalAgentsList?.find(a => a.agent_id === currentAgentId);
            const element = populateAgentPDFTemplate(agent || { agent_name: currentAgentName }, currentAgentSessionsData);
            if (!element) return showToast("No agent data available.", true);
            
            element.style.display = "block";
            
            const opt = {
              margin:       0.5,
              filename:     `AgentReport_${currentAgentName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
              image:        { type: 'jpeg', quality: 0.98 },
              html2canvas:  { scale: 1 },
              jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
              pagebreak:    { mode: ['css', 'legacy'] }
            };
            
            html2pdf().set(opt).from(element).save().then(() => {
                element.style.display = "none";
            });
        });
    }

    // removed redeclaration of btnExportAgentCSV
    if(btnExportAgentCSV) {
        btnExportAgentCSV.addEventListener("click", () => {
            if(!currentAgentName || !currentAgentSessionsData) return;
            
            const sessions = currentAgentSessionsData.filter(s => s.status !== "pending");
            if (sessions.length === 0) {
                showToast("No completed sessions to export.");
                return;
            }
            
            const count = sessions.length;
            let totalOverall = 0;
            
            let sums = {
                comm: 0, greeting: 0, listening: 0, probing: 0, validating: 0,
                tech: 0, troubleshooting: 0, solution: 0, escalation: 0, knowledge: 0,
                proc: 0, critical: 0, ticket: 0, time_entry: 0,
                cust: 0, ownership: 0, stakeholder: 0, proper_closing: 0,
                eff: 0, first_call: 0, thirty_min: 0, minimal_transfers: 0
            };
            
            sessions.forEach(s => {
                const ev = s.stage5_evaluation?.transcript_evaluation || {};
                totalOverall += (ev.overall_score_percentage || 0);
                
                const comm = ev.communication_professionalism || {};
                sums.greeting += comm.greeting_verification || 0;
                sums.listening += comm.active_listening_empathy || 0;
                sums.probing += comm.probing_issue || 0;
                sums.validating += comm.validating_priority || 0;
                sums.comm += ((comm.greeting_verification||0) + (comm.active_listening_empathy||0) + (comm.probing_issue||0) + (comm.validating_priority||0)) / 20 * 100;
                
                const tech = ev.technical_accuracy || {};
                sums.troubleshooting += tech.accurate_troubleshooting || 0;
                sums.solution += tech.solution_accuracy || 0;
                sums.escalation += tech.valid_escalation || 0;
                sums.knowledge += tech.knowledge_base_use || 0;
                sums.tech += ((tech.accurate_troubleshooting||0) + (tech.solution_accuracy||0) + (tech.valid_escalation||0) + (tech.knowledge_base_use||0)) / 30 * 100;
                
                const proc = ev.process_adherence || {};
                sums.critical += proc.critical_compliance || 0;
                sums.ticket += proc.ticket_documentation || 0;
                sums.time_entry += proc.time_entry_agreement || 0;
                sums.proc += ((proc.critical_compliance||0) + (proc.ticket_documentation||0) + (proc.time_entry_agreement||0)) / 20 * 100;
                
                const cust = ev.customer_experience || {};
                sums.ownership += cust.incident_ownership || 0;
                sums.stakeholder += cust.stakeholder_communication || 0;
                sums.proper_closing += cust.proper_closing_satisfaction || 0;
                sums.cust += ((cust.incident_ownership||0) + (cust.stakeholder_communication||0) + (cust.proper_closing_satisfaction||0)) / 20 * 100;
                
                const eff = ev.efficiency_metrics || {};
                sums.first_call += eff.first_call_resolution || 0;
                sums.thirty_min += eff.thirty_minute_rule || 0;
                sums.minimal_transfers += eff.minimal_transfers_holds || 0;
                sums.eff += ((eff.first_call_resolution||0) + (eff.thirty_minute_rule||0) + (eff.minimal_transfers_holds||0)) / 10 * 100;
            });
            
            const avg = (val) => (val / count).toFixed(1);
            const date = new Date().toLocaleDateString();
            
            let csvRows = [];
            csvRows.push([
                'Agent Name', 'Export Date', 'Total Calls', 'Avg Overall Score (%)',
                'Comm Score (%)', 'Greeting & Verification (/5)', 'Active Listening (/5)', 'Probing (/5)', 'Validating Priority (/5)',
                'Tech Score (%)', 'Accurate Troubleshooting (/10)', 'Solution Accuracy (/10)', 'Valid Escalation (/5)', 'Knowledge Base Use (/5)',
                'Process Score (%)', 'Critical/P1 Compliance (/5)', 'Ticket Documentation (/10)', 'Time Entry (/5)',
                'Customer Exp Score (%)', 'Incident Ownership (/5)', 'Stakeholder Comm (/10)', 'Proper Closing (/5)',
                'Efficiency Score (%)', 'First Call Res (/5)', '30 Min Rule (/3)', 'Minimal Transfers (/2)'
            ]);
            
            csvRows.push([
                `"${currentAgentName.replace(/"/g, '""')}"`, date, count, avg(totalOverall),
                avg(sums.comm), avg(sums.greeting), avg(sums.listening), avg(sums.probing), avg(sums.validating),
                avg(sums.tech), avg(sums.troubleshooting), avg(sums.solution), avg(sums.escalation), avg(sums.knowledge),
                avg(sums.proc), avg(sums.critical), avg(sums.ticket), avg(sums.time_entry),
                avg(sums.cust), avg(sums.ownership), avg(sums.stakeholder), avg(sums.proper_closing),
                avg(sums.eff), avg(sums.first_call), avg(sums.thirty_min), avg(sums.minimal_transfers)
            ]);
            
            const csvContent = csvRows.map(e => e.join(",")).join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Agent_Aggregate_${currentAgentName.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }
    
    
    
    const btnToggleTranscript = document.getElementById("btnToggleTranscript");
    const btnCopyTranscript = document.getElementById("btnCopyTranscript");
    
    if(btnToggleTranscript) {
        btnToggleTranscript.addEventListener("click", () => {
            const container = document.getElementById("transcriptContentContainer");
            if(container.style.display === "none") {
                container.style.display = "block";
                btnToggleTranscript.textContent = "Hide Transcript";
                if (btnCopyTranscript) btnCopyTranscript.style.display = "block";
            } else {
                container.style.display = "none";
                btnToggleTranscript.textContent = "Show Transcript";
                if (btnCopyTranscript) btnCopyTranscript.style.display = "none";
            }
        });
    }

    if(btnCopyTranscript) {
        btnCopyTranscript.addEventListener("click", () => {
            if(currentSessionData && currentSessionData.turns) {
                const ev = currentSessionData.stage5_evaluation?.transcript_evaluation || {};
                const agentSpk = ev.agent_speaker_label || "SPEAKER_00";
                const textToCopy = currentSessionData.turns.map(t => {
                    const displayName = t.speaker === agentSpk ? 'Agent' : 'Customer';
                    return `${displayName}: ${t.text}`;
                }).join("\n");
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalHTML = btnCopyTranscript.innerHTML;
                    btnCopyTranscript.innerHTML = '<i class="ms-Icon ms-Icon--CheckMark" style="color: #107c10;"></i>';
                    setTimeout(() => {
                        btnCopyTranscript.innerHTML = originalHTML;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy transcript: ', err);
                });
            }
        });
    }
    
    const btnCopyAgentSummary = document.getElementById("btnCopyAgentSummary");
    if(btnCopyAgentSummary) {
        btnCopyAgentSummary.addEventListener("click", () => {
            const toneTextEl = document.getElementById("agentSummaryToneText");
            if(toneTextEl && toneTextEl.textContent) {
                navigator.clipboard.writeText(toneTextEl.textContent.trim()).then(() => {
                    const originalHTML = btnCopyAgentSummary.innerHTML;
                    btnCopyAgentSummary.innerHTML = '<i class="ms-Icon ms-Icon--CheckMark"></i> Copied!';
                    setTimeout(() => {
                        btnCopyAgentSummary.innerHTML = originalHTML;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy agent summary: ', err);
                });
            }
        });
    }
    
    // Analytics Modal Logic
    const analyticsModal = document.getElementById("analyticsModal");
    const analyticsModalClose = document.getElementById("analyticsModalClose");
    const btnTabCall = document.getElementById("btnTabCall");
    
    const modalTabCall = document.getElementById("modalTabCall");
    const modalTabTrend = document.getElementById("modalTabTrend");
    const modalCallAnalyticsContainer = document.getElementById("modalCallAnalyticsContainer");
    const modalTrendContainer = document.getElementById("modalTrendContainer");
    
    function setModalTabActive(tabName) {
        if (!modalTabCall || !modalCallAnalyticsContainer || !modalTabTrend || !modalTrendContainer) return;
        
        // Reset both
        modalTabCall.classList.remove("active-tab");
        modalTabTrend.classList.remove("active-tab");
        modalTabCall.style.backgroundColor = "transparent";
        modalTabCall.style.color = "var(--text-primary)";
        modalTabTrend.style.backgroundColor = "transparent";
        modalTabTrend.style.color = "var(--text-primary)";
        
        modalCallAnalyticsContainer.style.display = "none";
        modalTrendContainer.style.display = "none";
        
        if (tabName === 'call') {
            modalTabCall.classList.add("active-tab");
            modalCallAnalyticsContainer.style.display = "flex";
            modalTabCall.style.backgroundColor = "var(--outlook-blue)";
            modalTabCall.style.color = "white";
        } else if (tabName === 'trend') {
            modalTabTrend.classList.add("active-tab");
            modalTrendContainer.style.display = "block";
            modalTabTrend.style.backgroundColor = "var(--outlook-blue)";
            modalTabTrend.style.color = "white";
        }
    }
    
    if (analyticsModalClose) {
        analyticsModalClose.addEventListener("click", () => analyticsModal.classList.remove("open"));
    }
    
    if (btnTabCall) {
        btnTabCall.addEventListener("click", () => {
            if (currentAgentSessionsData) renderCharts(currentAgentSessionsData);
            setModalTabActive('call');
            analyticsModal.classList.add("open");
        });
    }
    
    if (modalTabCall) {
        modalTabCall.addEventListener("click", () => setModalTabActive('call'));
    }
    
    if (modalTabTrend) {
        modalTabTrend.addEventListener("click", () => setModalTabActive('trend'));
    }
    
    // Removed btnViewGraphs and graphsModal logic

    dropZone.addEventListener("click", () => audioFileInput.click());
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files);
    });
    audioFileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files);
    });
    unifiedUploadForm.addEventListener("submit", (e) => { e.preventDefault(); startAnalysis(); });

    if (searchAgents) {
        searchAgents.addEventListener("input", (e) => filterAgents(e.target.value));
    }
    
    if (agentDepartmentFilter) {
        agentDepartmentFilter.addEventListener("change", (e) => {
            if (e.target.value === "custom") {
                customDepartmentContainer.style.display = "flex";
            } else {
                customDepartmentContainer.style.display = "none";
                filterAgents(searchAgents ? searchAgents.value : "");
            }
        });
    }
    
    if (btnApplyCustomDepartment) {
        btnApplyCustomDepartment.addEventListener("click", () => {
            const customDep = customDepartmentInput.value.trim();
            if (customDep) {
                // Add option if not exists, matching case-insensitively
                let matchedOption = Array.from(agentDepartmentFilter.options).find(o => o.value.toLowerCase() === customDep.toLowerCase());
                if (!matchedOption) {
                    const newOption = document.createElement('option');
                    newOption.value = customDep;
                    newOption.textContent = customDep;
                    agentDepartmentFilter.insertBefore(newOption, agentDepartmentFilter.lastElementChild);
                    agentDepartmentFilter.value = customDep;
                } else {
                    agentDepartmentFilter.value = matchedOption.value;
                }
                customDepartmentContainer.style.display = "none";
                filterAgents(searchAgents ? searchAgents.value : "");
            }
        });
    }

    let isEndDateManuallyChanged = false;

    customEndDate.addEventListener("change", () => {
        isEndDateManuallyChanged = true;
    });

    customStartDate.addEventListener("change", () => {
        if (!isEndDateManuallyChanged || !customEndDate.value) {
            customEndDate.value = customStartDate.value;
        }
    });

    agentDateFilter.addEventListener("change", () => {
        if (agentDateFilter.value === "custom") {
            customDateRangeContainer.style.display = "flex";
        } else {
            customDateRangeContainer.style.display = "none";
            loadAgents();
        }
    });
    
    if (sessionSortFilter) {
        sessionSortFilter.addEventListener("change", () => {
            if (currentAgentId) selectAgent(currentAgentId, currentAgentName);
        });
    }

    btnApplyCustomDate.addEventListener("click", () => {
        loadAgents();
    });

    const themeToggle = document.getElementById("themeToggle");
    if(themeToggle) {
        themeToggle.addEventListener("click", () => {
            const isDark = document.body.classList.toggle("dark-theme");
            document.body.classList.toggle("light-theme", !isDark);
            themeToggle.innerHTML = isDark ? 
                '<i class="ms-Icon ms-Icon--Sunny" aria-hidden="true"></i>' : 
                '<i class="ms-Icon ms-Icon--ClearNight" aria-hidden="true"></i>';
        });
    }
    
    const btnDeleteSession = document.getElementById("btnDeleteSession");
    if (btnDeleteSession) {
        btnDeleteSession.addEventListener("click", deleteCurrentSession);
    }
    
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

function handleFileSelect(files) {
    const isZip = document.querySelector('input[name="uploadType"]:checked').value === "zip";
    if (isZip) {
        selectedFiles = [files[0]];
        fileInfo.textContent = `${files[0].name} (${(files[0].size / (1024 * 1024)).toFixed(2)} MB)`;
    } else {
        selectedFiles = Array.from(files);
        if (selectedFiles.length === 1) {
            fileInfo.textContent = `${selectedFiles[0].name} (${(selectedFiles[0].size / (1024 * 1024)).toFixed(2)} MB)`;
        } else {
            fileInfo.textContent = `${selectedFiles.length} files selected`;
        }
    }
    fileInfo.style.color = "var(--outlook-blue)";
}

function resetForm() {
    newAnalysisForm.reset();
    selectedFiles = [];
    fileInfo.textContent = "Supports MP3, WAV, M4A, FLAC";
    fileInfo.style.color = "var(--text-muted)";
}


function handleBulkFileSelect(file) {
    selectedBulkFile = file;
    bulkFileInfo.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    bulkFileInfo.style.color = "var(--outlook-blue)";
}

async function reevaluateCurrentSession() {
    if (!currentSessionId) return showToast("No session selected.", true);
    // We need a topic. If current session doesn't have it locally, we just pass the existing one.
    // In our UI, sessionTopic.textContent has it.
    const topic = document.getElementById("sessionTopic").textContent;
    
    const formData = new FormData();
    formData.append("topic", topic);
    if (analysisAgentName && analysisAgentName.value) {
        formData.append("agent_name", analysisAgentName.value);
    }
    if (analysisAgentName && analysisAgentName.dataset.id) {
        formData.append("agent_id", analysisAgentName.dataset.id);
    }
    
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
        showToast(e.message, true);
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
        showToast(e.message, true);
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
        
        const activeWithCalls = agents.filter(a => !a.is_deleted && a.total_calls > 0).sort((a, b) => (a.avg_score || 0) - (b.avg_score || 0));
        const activeWithoutCalls = agents.filter(a => !a.is_deleted && a.total_calls === 0);
        const deletedAgents = agents.filter(a => a.is_deleted);
        
        window.globalAgentsList = agents;
        
        const renderAgentItem = (agent) => {
            const scoreDisplay = agent.total_calls === 0 ? "N/A" : `${agent.avg_score}%`;
            const badgeBg = getScoreBgColor(agent.avg_score, agent.total_calls === 0);
            const depAttr = agent.department ? `data-department="${agent.department.toLowerCase()}"` : `data-department=""`;
            
            return `
            <div class="session-item ${agent.is_deleted ? 'agent-deleted' : ''}" data-id="${agent.agent_id}" ${depAttr} onclick="selectAgent('${agent.agent_id}', '${agent.agent_name.replace(/'/g, "\\'")}')" ${agent.is_deleted ? 'style="color: var(--accent-red); opacity: 0.6;"' : ''}>
                <div class="session-item-top" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div style="display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
                        <span class="session-title" style="word-break: break-word; ${agent.is_deleted ? 'color: var(--accent-red);' : ''}">${agent.agent_name} ${agent.agent_id !== agent.agent_name ? `<span style="font-size: 14px; opacity: 0.7;">(${agent.agent_id})</span>` : ''}</span>
                        <div class="session-meta">
                            <span>${agent.total_calls} calls ${agent.department ? `| ${agent.department}` : ''}</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                        <span class="score-badge" style="background-color: ${badgeBg}; color: ${badgeBg === uiColors.na ? '#202124' : '#fff'};">${scoreDisplay}</span>
                        ${agent.is_deleted ? 
                            `<button class="icon-btn" onclick="restoreAgent(event, '${agent.agent_id}')" title="Restore Agent" style="background: none; border: none; color: var(--accent-blue); cursor: pointer;">
                                <i class="ms-Icon ms-Icon--Undo" style="font-size: 17px;"></i>
                            </button>` :
                            `<button class="icon-btn edit-agent-btn" onclick="window.openEditAgentModal(event, '${agent.agent_id}')" title="Edit Agent" style="background: none; border: none; color: var(--outlook-blue); cursor: pointer; margin-right: 5px;">
                                <i class="ms-Icon ms-Icon--Edit" style="font-size: 17px;"></i>
                            </button>
                            <button class="icon-btn delete-agent-btn" onclick="deleteAgent(event, '${agent.agent_id}')" title="Delete Agent" style="background: none; border: none; color: var(--text-secondary); cursor: pointer;">
                                <i class="ms-Icon ms-Icon--Delete" style="font-size: 17px;"></i>
                            </button>`
                        }
                    </div>
                </div>
            </div>
            `;
        };

        let html = activeWithCalls.map(renderAgentItem).join("");
        html += activeWithoutCalls.map(renderAgentItem).join("");
        
        if (deletedAgents.length > 0) {
            html += `
                <div id="deletedAgentsSection" style="margin-top: 15px; border-top: 1px solid var(--border-color); padding-top: 5px;">
                    <button id="btnToggleDeleted" style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 10px; background: none; border: none; cursor: pointer; color: var(--text-secondary); font-weight: 600;" onclick="const c = document.getElementById('deletedAgentsContainer'); const i = this.querySelector('i'); if(c.style.display==='none'){c.style.display='block'; i.className='ms-Icon ms-Icon--ChevronUp';}else{c.style.display='none'; i.className='ms-Icon ms-Icon--ChevronDown';}">
                        <span>Deleted Agents (${deletedAgents.length})</span>
                        <i class="ms-Icon ms-Icon--ChevronDown" style="font-size: 15px;"></i>
                    </button>
                    <div id="deletedAgentsContainer" style="display: none;">
                        ${deletedAgents.map(renderAgentItem).join("")}
                    </div>
                </div>
            `;
        }
        
        agentList.innerHTML = html;
        
        let firstRenderedAgent = activeWithCalls.length > 0 ? activeWithCalls[0] : (activeWithoutCalls.length > 0 ? activeWithoutCalls[0] : (deletedAgents.length > 0 ? deletedAgents[0] : null));
        if (firstRenderedAgent) {
            selectAgent(firstRenderedAgent.agent_id, firstRenderedAgent.agent_name, true);
        }
    } catch (e) {
        agentList.innerHTML = '<p class="error-msg">Failed to load agents.</p>';
    }
}

function filterAgents(q) {
    const term = (q || '').toLowerCase();
    const selectedDep = agentDepartmentFilter ? agentDepartmentFilter.value : "all";
    
    agentList.querySelectorAll(".session-item").forEach(el => {
        const titleText = el.querySelector(".session-title").textContent.toLowerCase();
        const agentDep = el.getAttribute("data-department") || "";
        const titleMatch = titleText.includes(term) || agentDep.includes(term);
        let depMatch = true;
        
        if (selectedDep !== "all" && selectedDep !== "custom") {
            // Special handling for "Support / Tech Support" option
            if (selectedDep === "Support") {
                depMatch = agentDep.includes("support");
            } else {
                depMatch = agentDep === selectedDep.toLowerCase();
            }
        }
        
        if (titleMatch && depMatch) {
            el.style.display = "flex";
        } else {
            el.style.display = "none";
        }
    });
}

async function selectAgent(agentId, agentName, isAuto = false) {
    currentAgentId = agentId;
    currentAgentName = agentName;
    selectedAgentName.textContent = agentName;
    
    // Update responsive state
    if (!isAuto || window.innerWidth > 768) {
        outlookApp.classList.remove("state-agent-list", "state-recording-analysis");
        outlookApp.classList.add("state-agent-details");
    }
    
    // Disable uploads if deleted
    const btnUploadSingle = document.getElementById("btnUploadAudio");
    const btnUploadBatch = document.getElementById("btnBatchUpload");
    const btnUnifiedUploadMid = document.getElementById("btnUnifiedUpload");
    const btnExportPDF = document.getElementById("btnExportAgentPDF");
    const btnExportCSV = document.getElementById("btnExportAgentCSV");
    const agentData = window.globalAgentsList?.find(a => a.agent_id === agentId);
    if (agentData && agentData.is_deleted) {
        if(btnUploadSingle) { btnUploadSingle.disabled = true; btnUploadSingle.style.opacity = "0.5"; btnUploadSingle.title = "Agent is deleted"; }
        if(btnUploadBatch) { btnUploadBatch.disabled = true; btnUploadBatch.style.opacity = "0.5"; btnUploadBatch.title = "Agent is deleted"; }
        if(btnUnifiedUploadMid) { btnUnifiedUploadMid.disabled = true; btnUnifiedUploadMid.style.opacity = "0.5"; btnUnifiedUploadMid.title = "Agent is deleted"; }
        if(btnExportPDF) { btnExportPDF.disabled = true; btnExportPDF.style.opacity = "0.5"; btnExportPDF.title = "Agent is deleted"; }
        if(btnExportCSV) { btnExportCSV.disabled = true; btnExportCSV.style.opacity = "0.5"; btnExportCSV.title = "Agent is deleted"; }
    } else {
        if(btnUploadSingle) { btnUploadSingle.disabled = false; btnUploadSingle.style.opacity = "1"; btnUploadSingle.title = ""; }
        if(btnUploadBatch) { btnUploadBatch.disabled = false; btnUploadBatch.style.opacity = "1"; btnUploadBatch.title = ""; }
        if(btnUnifiedUploadMid) { btnUnifiedUploadMid.disabled = false; btnUnifiedUploadMid.style.opacity = "1"; btnUnifiedUploadMid.title = "Upload Audio (Single or ZIP) for this Agent"; }
        if(btnExportPDF) { btnExportPDF.disabled = false; btnExportPDF.style.opacity = "1"; btnExportPDF.title = "Export Agent Report (PDF)"; }
        if(btnExportCSV) { btnExportCSV.disabled = false; btnExportCSV.style.opacity = "1"; btnExportCSV.title = "Export Agent Report (CSV)"; }
    }
    
    agentList.querySelectorAll(".session-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.id === agentId);
    });
    
    // Clear the right panel while loading or if no sessions
    readingPaneContent.classList.add("hidden");
    emptyState.classList.remove("hidden");


    const filterValue = agentDateFilter.value;
    let url = `/api/agents/${encodeURIComponent(agentId)}/sessions`;
    if (filterValue === "custom") {
        const sd = customStartDate.value;
        const ed = customEndDate.value;
        
        // Convert to Unix timestamps based on the user's local timezone
        const startTs = Math.floor(new Date(sd + "T00:00:00").getTime() / 1000);
        const endTs = Math.floor(new Date(ed + "T23:59:59").getTime() / 1000);
        
        url += `?start_ts=${startTs}&end_ts=${endTs}`;
    } else {
        url += `?days=${filterValue}`;
    }
    
    try {
        const res = await fetch(url);
        const sessions = await res.json();
        
        const chronologicalSessions = [...sessions].sort((a, b) => a.created_at - b.created_at);
        chronologicalSessions.forEach((s, index) => {
            s.displayTitle = `Call ${index + 1}`;
        });
        
        const sortMode = sessionSortFilter ? sessionSortFilter.value : "newest";
        sessions.sort((a, b) => {
            if (sortMode === "newest") return b.created_at - a.created_at;
            if (sortMode === "oldest") return a.created_at - b.created_at;
            
            const scoreA = (a.stage5_evaluation?.transcript_evaluation?.overall_score_percentage) || 0;
            const scoreB = (b.stage5_evaluation?.transcript_evaluation?.overall_score_percentage) || 0;
            
            if (sortMode === "highest_score") return scoreB - scoreA;
            if (sortMode === "lowest_score") return scoreA - scoreB;
            return 0;
        });

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
        
        agentSummaryCard.style.display = "block";
        currentAgentSessionsData = sessions;
        
        // Render trend chart if > 1 call
        renderTrendChart(sessions);
        
        if (btnExportAgentPDF) btnExportAgentPDF.style.display = "block";
        if (btnExportAgentCSV) btnExportAgentCSV.style.display = "block";

        agentSessionsList.innerHTML = sessions.map(session => {
            const isPending = session.status === "pending";
            const isFailed = session.status === "failed";
            const ev = session.stage5_evaluation?.transcript_evaluation || {};
            let score = ev.overall_score_percentage || 0;
            let badgeBg = getScoreBgColor(score, false);
            
            let badgeHtml = "";
            if (isPending || isFailed) {
                badgeHtml = `<button class="fluent-btn-primary" style="padding: 2px 8px; font-size: 14px; min-width: auto; height: 22px; ${isFailed ? 'background-color: var(--text-danger);' : ''}" onclick="runPendingAnalysis(event, '${session.session_id}')">${isFailed ? 'Retry' : 'Analyze'}</button>`;
            } else {
                badgeHtml = `<span class="score-badge" style="background-color: ${badgeBg}; color: #fff;">${score.toFixed(1)}%</span>`;
            }
                
            return `
                <div class="session-item" data-id="${session.session_id}" onclick="selectSession('${session.session_id}')">
                    <div class="session-item-top">
                        <span class="session-title">${session.displayTitle || 'Session'}</span>
                        ${badgeHtml}
                    </div>
                    <div class="session-meta">
                        <span>${new Date(session.created_at * 1000).toLocaleDateString()}</span>
                    </div>
                </div>
            `;
        }).join("");
        
        if (sessions.length > 0) {
            // Always treat auto-selecting the first session as 'auto' so mobile UI doesn't jump
            selectSession(sessions[0].session_id, true);
        }

    } catch (e) {
        agentSessionsList.innerHTML = '<p class="error-msg">Error loading agent sessions.</p>';
    }
}

async function selectSession(sessionId, isAuto = false) {
    currentSessionId = sessionId;
    agentSessionsList.querySelectorAll(".session-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.id === sessionId);
    });

    // Update responsive state
    if (!isAuto || window.innerWidth > 768) {
        outlookApp.classList.remove("state-agent-list", "state-agent-details");
        outlookApp.classList.add("state-recording-analysis");
    }

    try {
        const response = await fetch(`/api/sessions/${sessionId}`);
        const session = await response.json();
        currentSessionData = session;
        renderSessionReport(session);
    } catch (err) {
        showToast("Failed to load session details.", true);
    }
}

function renderSessionReport(session) {
    if (session.status === "pending") {
        emptyState.classList.remove("hidden");
        readingPaneContent.classList.add("hidden");
        emptyState.innerHTML = `<i class="ms-Icon ms-Icon--Processing" aria-hidden="true" style="font-size: 48px; color: var(--outlook-blue);"></i><h1 style="margin-top: 20px;">Pending Analysis</h1><p>Click the Analyze button in the sessions list to process this recording.</p>`;
        return;
    } else if (session.status === "failed") {
        emptyState.classList.remove("hidden");
        readingPaneContent.classList.add("hidden");
        emptyState.innerHTML = `<i class="ms-Icon ms-Icon--Error" aria-hidden="true" style="font-size: 48px; color: var(--text-danger, #d13438);"></i><h1 style="margin-top: 20px;">Analysis Failed</h1><p>${session.error || "An error occurred during analysis."}</p>`;
        return;
    } else if (session.status === "no_speech_detected") {
        emptyState.classList.remove("hidden");
        readingPaneContent.classList.add("hidden");
        emptyState.innerHTML = `<i class="ms-Icon ms-Icon--MicOff2" aria-hidden="true" style="font-size: 48px; color: var(--text-danger, #d13438);"></i><h1 style="margin-top: 20px;">No Speech Detected</h1><p>No human speech could be detected in this audio file.</p>`;
        return;
    } else {
        emptyState.innerHTML = `<i class="ms-Icon ms-Icon--Audio" aria-hidden="true"></i><h1>Select a Recording</h1><p>Select a session from the middle panel to view its detailed QA scorecard.</p>`;
        emptyState.classList.add("hidden");
        readingPaneContent.classList.remove("hidden");
    }

    const sessionListItem = currentAgentSessionsData?.find(s => s.session_id === session.session_id);
    const displayTitle = sessionListItem?.displayTitle || session.topic || "Voice Session";
    sessionTopic.textContent = displayTitle;
    
    // Attach to currentSessionData for use in PDF/Email
    currentSessionData.displayTitle = displayTitle;
    
    // Master audio player (PII scrubbed)
    masterAudioPlayer.src = `/static/audio/${session.session_id}/beeped_input.wav`;
    
    const ev = session.stage5_evaluation?.transcript_evaluation;
    if (ev) {
        let score = ev.overall_score_percentage || 0;
        
        // Emotional Summary calculation for 6th box
        const sessionEmotionsRaw = session.stage5_evaluation?.speaker_emotions || {};
        const score6 = document.getElementById("score6");
        
        let allEmotionsHtml = `<div style="display: flex; justify-content: space-between; gap: 10px;">`;
        let emotionParamsHtml = '';
        
        Object.keys(sessionEmotionsRaw).forEach(spk => {
            let sessionEmotionCounts = {};
            if (sessionEmotionsRaw[spk].all_emotions && Object.keys(sessionEmotionsRaw[spk].all_emotions).length > 0) {
                sessionEmotionCounts = sessionEmotionsRaw[spk].all_emotions;
            } else {
                let em = (sessionEmotionsRaw[spk].emotion || 'neutral').toLowerCase();
                em = em.charAt(0).toUpperCase() + em.slice(1);
                sessionEmotionCounts[em] = 10;
            }
            
            const spkLabel = spk === (ev.agent_speaker_label || "Agent") ? "Agent" : "Customer";
            let topEmo = Object.entries(sessionEmotionCounts).sort((a,b)=>b[1]-a[1])[0];
            let topEmoStr = topEmo ? topEmo[0] : "Neutral";
            let topEmoPct = topEmo ? topEmo[1] : 0;
            
            allEmotionsHtml += `
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px;">${spkLabel}</div>
                    <div style="font-size: 18px; font-weight: 600; color: var(--text-primary);">${topEmoStr}</div>
                    <div style="font-size: 12px; color: #666; margin-top: 4px;">Score: ${topEmoPct * 10}%</div>
                </div>
            `;
            
            let sortedSessionEmotions = Object.entries(sessionEmotionCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);
            emotionParamsHtml += `<div style="font-weight: bold; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #eee; padding-bottom: 5px;">${spkLabel}</div>`;
            if (sortedSessionEmotions.length === 0) {
                emotionParamsHtml += `<p style="font-size: 16px; color: var(--text-muted); font-style: italic;">No emotion data available.</p>`;
            } else {
                sortedSessionEmotions.forEach(([emo, pct]) => {
                    let capEmo = emo.charAt(0).toUpperCase() + emo.slice(1);
                    emotionParamsHtml += `
                    <div style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; font-size: 16px; margin-bottom: 6px;">
                            <span style="color: var(--text-primary); font-weight: 500;">${capEmo}</span>
                            <span style="font-weight: 700; color: var(--text-primary);">${pct * 10}%</span>
                        </div>
                    </div>`;
                });
            }
        });
        allEmotionsHtml += `</div>`;
        
        if (!allEmotionsHtml || Object.keys(sessionEmotionsRaw).length === 0) {
            allEmotionsHtml = `
                <div style="font-size: 20px; font-weight: 600; color: var(--text-primary);">Neutral</div>
                <div style="font-size: 12px; color: #666; margin-top: 4px;">Score: 0%</div>
            `;
            emotionParamsHtml = `<p style="font-size: 16px; color: var(--text-muted); font-style: italic;">No emotion data available.</p>`;
        }
        
        if(score6) {
            score6.innerHTML = allEmotionsHtml;
        }
        
        document.getElementById("qaOverallScore").textContent = score + "%";
        
        sessionSenderName.textContent = "Scored by AI";
        senderAvatar.textContent = "AI";
        if(sessionDetailsMeta) {
            sessionDetailsMeta.textContent = `Agent: ${currentAgentName || "Unknown Agent"} | Completed`;
        }

        function renderMetric(label, value, max) {
            let valNum = (value !== undefined && value !== 'N/A' && value !== null && value !== -1) ? parseInt(value) : -1;
            let displayVal = valNum >= 0 ? `${valNum}/${max}` : 'N/A';
            let pct = valNum >= 0 ? (valNum / max) * 100 : 0;
            let color = valNum < 0 ? 'var(--text-muted)' : 'var(--text-primary)';
            let barColor = getScoreBgColor(pct, valNum < 0);
            
            return `
                <div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 16px; margin-bottom: 6px;">
                        <span style="color: var(--text-primary); font-weight: 500;">${label}</span>
                        <span style="font-weight: 700; color: ${color};">${displayVal}</span>
                    </div>
                    <div style="height: 6px; background-color: rgba(128, 128, 128, 0.2); border-radius: 4px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);">
                        <div style="height: 100%; width: ${valNum >= 0 ? pct : 0}%; background: ${barColor}; border-radius: 4px; transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
                    </div>
                </div>
            `;
        };

        const catHTML = `
            <div class="scorecard-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 24px; margin-top: 20px;">
                
                <!-- Communication & Professionalism -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--Message" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Communication & Professionalism</h4>
                    </div>
                    ${renderMetric('Greeting & Verification', ev.communication_professionalism?.greeting_verification, 5)}
                    ${renderMetric('Active Listening & Empathy', ev.communication_professionalism?.active_listening_empathy, 5)}
                    ${renderMetric('Probing the Issue', ev.communication_professionalism?.probing_issue, 5)}
                    ${renderMetric('Validating Priority', ev.communication_professionalism?.validating_priority, 5)}
                </div>

                <!-- Technical Accuracy & Resolution -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--Repair" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Technical Accuracy</h4>
                    </div>
                    ${renderMetric('Accurate Troubleshooting', ev.technical_accuracy?.accurate_troubleshooting, 10)}
                    ${renderMetric('Solution Accuracy', ev.technical_accuracy?.solution_accuracy, 10)}
                    ${renderMetric('Valid Escalation', ev.technical_accuracy?.valid_escalation, 5)}
                    ${renderMetric('Knowledge Base Use', ev.technical_accuracy?.knowledge_base_use, 5)}
                </div>
                
                <!-- Process Adherence -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--ComplianceAsset" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Process Adherence</h4>
                    </div>
                    ${renderMetric('Critical/P1 Compliance', ev.process_adherence?.critical_compliance, 5)}
                    ${renderMetric('Ticket Documentation', ev.process_adherence?.ticket_documentation, 10)}
                    ${renderMetric('Time Entry & Agreement', ev.process_adherence?.time_entry_agreement, 5)}
                </div>
                
                <!-- Customer Experience -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--Heart" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Customer Experience</h4>
                    </div>
                    ${renderMetric('Ownership of Incident', ev.customer_experience?.incident_ownership, 5)}
                    ${renderMetric('Stakeholder Communication', ev.customer_experience?.stakeholder_communication, 10)}
                    ${renderMetric('Proper Closing & Satisfaction', ev.customer_experience?.proper_closing_satisfaction, 5)}
                </div>
                
                <!-- Efficiency Metrics -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--SpeedHigh" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Efficiency</h4>
                    </div>
                    ${renderMetric('First Call Resolution', ev.efficiency_metrics?.first_call_resolution, 5)}
                    ${renderMetric('30 Minute Rule', ev.efficiency_metrics?.thirty_minute_rule, 3)}
                    ${renderMetric('Minimal Transfers/Holds', ev.efficiency_metrics?.minimal_transfers_holds, 2)}
                </div>
                
                <!-- Emotional Summary (6th Box) -->
                <div class="scorecard-section" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.04); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: linear-gradient(to bottom, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(0, 120, 212, 0.1); display: flex; align-items: center; justify-content: center; color: #0078d4;">
                            <i class="ms-Icon ms-Icon--Emoji2" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Emotional Summary</h4>
                    </div>
                    ${emotionParamsHtml}
                </div>

                <!-- Reviewer Feedback -->
                <div class="scorecard-section" style="grid-column: 1 / -1; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 26px; box-shadow: 0 8px 32px rgba(0,0,0,0.06); display: flex; flex-direction: column; gap: 18px; margin-top: 10px; position: relative;">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 4px; background: linear-gradient(to right, #0078d4, #50e4ff);"></div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 20px; background: linear-gradient(135deg, #0078d4, #50e4ff); display: flex; align-items: center; justify-content: center; color: white;">
                            <i class="ms-Icon ms-Icon--Feedback" aria-hidden="true" style="font-size: 20px;"></i>
                        </div>
                        <h4 style="margin: 0; font-size: 20px; font-weight: 600; flex: 1;">Feedback</h4>
                        <button class="toolbar-btn" id="btnCopyFeedback" title="Copy Feedback">
                            <i class="ms-Icon ms-Icon--Copy" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div style="font-size: 17px; line-height: 1.7; color: var(--text-primary); background: rgba(128,128,128,0.05); padding: 20px; border-radius: 10px; border-left: 4px solid #0078d4; font-style: italic;">
                        "${ev.technical_reviewer_feedback || 'No actionable feedback provided for this session.'}"
                    </div>
                </div>

            </div>
        `;
        document.getElementById("qaCategoriesContainer").innerHTML = catHTML;

        const btnCopyFeedback = document.getElementById("btnCopyFeedback");
        if (btnCopyFeedback) {
            btnCopyFeedback.addEventListener("click", () => {
                const textToCopy = ev.technical_reviewer_feedback || 'No actionable feedback provided for this session.';
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalHTML = btnCopyFeedback.innerHTML;
                    btnCopyFeedback.innerHTML = '<i class="ms-Icon ms-Icon--CheckMark" style="color: #107c10;"></i>';
                    setTimeout(() => {
                        btnCopyFeedback.innerHTML = originalHTML;
                    }, 2000);
                }).catch(err => console.error('Failed to copy feedback: ', err));
            });
        }
    }

    if (speakerCardsGrid) speakerCardsGrid.innerHTML = "";
    
    const transcriptContainer = document.getElementById("transcriptContentContainer");
    if(transcriptContainer && session.turns) {
        const ev = session.stage5_evaluation?.transcript_evaluation || {};
        const agentSpk = ev.agent_speaker_label || "SPEAKER_00";
        transcriptContainer.innerHTML = session.turns.map(t => {
            const isAgent = t.speaker === agentSpk;
            const color = isAgent ? 'var(--outlook-blue)' : 'var(--text-primary)';
            const displayName = isAgent ? 'Agent' : 'Customer';
            return `<div style="margin-bottom: 12px;">
                <strong style="color: ${color};">${displayName}:</strong> 
                <span style="color: var(--text-primary);">${t.text}</span>
            </div>`;
        }).join('');
        
        // Reset toggle button
        const btnToggleTranscript = document.getElementById("btnToggleTranscript");
        const btnCopyTranscript = document.getElementById("btnCopyTranscript");
        if(btnToggleTranscript) {
            btnToggleTranscript.textContent = "Hide Transcript";
            transcriptContainer.style.display = "block";
        }
        if(btnCopyTranscript) {
            btnCopyTranscript.style.display = "inline-block";
        }
    } else if(transcriptContainer) {
        transcriptContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center;">No transcript available for this session.</div>';
    }

    if (currentAgentSessionsData) renderCharts(currentAgentSessionsData);
}

// Chart.js render logic
let qaRadarChartInstance = null;
let emotionPolarChartInstance = null;
let trendLineChartInstance = null;
let performanceDistributionChartInstance = null;
let topImprovementAreasChartInstance = null;

function renderTrendChart(sessions) {
    const container = document.getElementById('trendChartContainer');
    if (!container) return;
    
    // Filter out pending sessions and sort by date ascending (assuming older sessions are at the end, let's reverse them or sort by ID/date)
    const completedSessions = sessions.filter(s => s.status !== "pending").reverse();
    const emptyState = document.getElementById("trendChartEmptyState");
    const canvas = document.getElementById("trendLineChart");
    
    if (completedSessions.length === 0) {
        if (emptyState) emptyState.style.display = "flex";
        canvas.style.display = "none";
        return;
    } else {
        if (emptyState) emptyState.style.display = "none";
        canvas.style.display = "block";
    }
    
    // Note: We don't force 'display: block' on container here anymore, because it depends on which tab is active.
    // The tab button clicks handle the container display.
    
    const labels = completedSessions.map((s, i) => `Call ${i + 1}`);
    const data = completedSessions.map(s => s.stage5_evaluation?.transcript_evaluation?.overall_score_percentage || 0);
    
    const ctx = document.getElementById('trendLineChart').getContext('2d');
    
    if (trendLineChartInstance) trendLineChartInstance.destroy();
    
    trendLineChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Overall Score %',
                data: data,
                borderColor: 'rgba(0, 120, 212, 1)',
                backgroundColor: 'rgba(0, 120, 212, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(0, 120, 212, 1)',
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        font: { size: 10, family: "'Outfit', sans-serif" }
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10, family: "'Outfit', sans-serif" }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: "'Outfit', sans-serif" },
                    bodyFont: { family: "'Outfit', sans-serif" }
                }
            }
        }
    });
}

function renderCharts(sessions) {
    if (!sessions) return;
    if (!Array.isArray(sessions)) sessions = [sessions];
    
    const completedSessions = sessions.filter(s => s.status !== "pending");
    if (completedSessions.length === 0) return;

    let commTotal = 0, techTotal = 0, procTotal = 0, custTotal = 0, effTotal = 0;
    let emotionCounts = { 'Neutral': 0, 'Frustrated': 0, 'Happy': 0, 'Sad': 0, 'Angry': 0 };
    
    // Data structures for new charts
    let distributionCounts = { excellent: 0, good: 0, needsImprovement: 0 };
    let subMetricTotals = {};
    let subMetricCounts = {};
    
    const addSubMetric = (metric, maxScore, actualScore) => {
        if (actualScore === undefined || actualScore === null) return;
        const key = metric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (!subMetricTotals[key]) {
            subMetricTotals[key] = 0;
            subMetricCounts[key] = 0;
        }
        subMetricTotals[key] += (actualScore / maxScore) * 100;
        subMetricCounts[key]++;
    };
    
    completedSessions.forEach(session => {
        const ev = session.stage5_evaluation?.transcript_evaluation;
        if (!ev) return;

        // Score Distribution
        const overall = ev.overall_score_percentage || 0;
        if (overall >= 90) distributionCounts.excellent++;
        else if (overall >= 75) distributionCounts.good++;
        else distributionCounts.needsImprovement++;
        
        // Track individual sub-metrics
        addSubMetric('greeting_verification', 5, ev.communication_professionalism?.greeting_verification);
        addSubMetric('active_listening_empathy', 5, ev.communication_professionalism?.active_listening_empathy);
        addSubMetric('probing_issue', 5, ev.communication_professionalism?.probing_issue);
        addSubMetric('validating_priority', 5, ev.communication_professionalism?.validating_priority);
        
        addSubMetric('accurate_troubleshooting', 10, ev.technical_accuracy?.accurate_troubleshooting);
        addSubMetric('solution_accuracy', 10, ev.technical_accuracy?.solution_accuracy);
        addSubMetric('valid_escalation', 5, ev.technical_accuracy?.valid_escalation);
        addSubMetric('use_of_knowledge_base', 5, ev.technical_accuracy?.use_of_knowledge_base);
        
        addSubMetric('critical_compliance', 5, ev.process_adherence?.critical_compliance);
        addSubMetric('ticket_documentation', 10, ev.process_adherence?.ticket_documentation);
        addSubMetric('time_entry_agreement', 5, ev.process_adherence?.time_entry_agreement);
        
        addSubMetric('incident_ownership', 5, ev.customer_experience?.incident_ownership);
        addSubMetric('stakeholder_communication', 10, ev.customer_experience?.stakeholder_communication);
        addSubMetric('proper_closing_satisfaction', 5, ev.customer_experience?.proper_closing_satisfaction);
        
        addSubMetric('first_call_resolution', 5, ev.efficiency_metrics?.first_call_resolution);
        addSubMetric('thirty_minute_rule', 3, ev.efficiency_metrics?.thirty_minute_rule);
        addSubMetric('minimal_transfers_holds', 2, ev.efficiency_metrics?.minimal_transfers_holds);

        commTotal += ((ev.communication_professionalism?.greeting_verification || 0) +
                      (ev.communication_professionalism?.active_listening_empathy || 0) +
                      (ev.communication_professionalism?.probing_issue || 0) +
                      (ev.communication_professionalism?.validating_priority || 0)) / 20 * 100;

        techTotal += ((ev.technical_accuracy?.accurate_troubleshooting || 0) +
                      (ev.technical_accuracy?.solution_accuracy || 0) +
                      (ev.technical_accuracy?.valid_escalation || 0)) / 25 * 100;

        procTotal += ((ev.process_adherence?.critical_compliance || 0) +
                      (ev.process_adherence?.ticket_documentation || 0) +
                      (ev.process_adherence?.time_entry_agreement || 0)) / 20 * 100;

        custTotal += ((ev.customer_experience?.incident_ownership || 0) +
                      (ev.customer_experience?.stakeholder_communication || 0) +
                      (ev.customer_experience?.proper_closing_satisfaction || 0)) / 20 * 100;

        effTotal  += ((ev.efficiency_metrics?.first_call_resolution || 0) +
                      (ev.efficiency_metrics?.thirty_minute_rule || 0) +
                      (ev.efficiency_metrics?.minimal_transfers_holds || 0)) / 10 * 100;

        const agentSpk = ev.agent_speaker_label || "Agent";
        const emotionsRaw = session.stage5_evaluation?.speaker_emotions || {};
        
        if (agentSpk && emotionsRaw[agentSpk] && emotionsRaw[agentSpk].all_emotions && Object.keys(emotionsRaw[agentSpk].all_emotions).length > 0) {
            Object.entries(emotionsRaw[agentSpk].all_emotions).forEach(([k, v]) => {
                if (emotionCounts[k]) emotionCounts[k] += v;
                else emotionCounts[k] = v;
            });
        } else {
            Object.values(emotionsRaw).forEach(e => {
                let em = (e.emotion || 'neutral').toLowerCase();
                em = em.charAt(0).toUpperCase() + em.slice(1);
                if (emotionCounts[em] !== undefined) emotionCounts[em]++;
                else emotionCounts[em] = 1;
            });
        }
    });

    const count = completedSessions.length;
    const commAvg = commTotal / count;
    const techAvg = techTotal / count;
    const procAvg = procTotal / count;
    const custAvg = custTotal / count;
    const effAvg = effTotal / count;

    const ctx = document.getElementById('qaRadarChart').getContext('2d');
    
    const qaData = {
        labels: ['Communication', 'Tech Accuracy', 'Process', 'Customer Exp', 'Efficiency'],
        datasets: [{
            label: 'Average Score %',
            data: [commAvg, techAvg, procAvg, custAvg, effAvg],
            backgroundColor: 'rgba(0, 120, 212, 0.2)',
            borderColor: 'rgba(0, 120, 212, 1)',
            pointBackgroundColor: 'rgba(0, 120, 212, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(0, 120, 212, 1)',
            borderWidth: 2,
            fill: true
        }, {
            label: `Target Benchmark (${targetBenchmark}%)`,
            data: [targetBenchmark, targetBenchmark, targetBenchmark, targetBenchmark, targetBenchmark],
            backgroundColor: 'rgba(255, 159, 64, 0.1)',
            borderColor: 'rgba(255, 159, 64, 0.8)',
            borderDash: [5, 5],
            pointBackgroundColor: 'rgba(255, 159, 64, 0.8)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(255, 159, 64, 0.8)',
            borderWidth: 2,
            fill: true
        }]
    };

    if (qaRadarChartInstance) qaRadarChartInstance.destroy();
    qaRadarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: qaData,
        options: {
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            },
            layout: {
                padding: { top: 30, bottom: 30, left: 35, right: 35 }
            },
            scales: {
                r: {
                    angleLines: { color: 'rgba(0, 0, 0, 0.1)' },
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    pointLabels: {
                        font: { family: 'Outfit', size: 14, weight: '600' },
                        color: '#333'
                    },
                    ticks: {
                        min: 0,
                        max: 100,
                        stepSize: 20,
                        backdropColor: 'transparent',
                        font: { family: 'Outfit', size: 12 },
                        color: '#666'
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#333',
                    bodyColor: '#555',
                    titleFont: { family: 'Outfit', size: 14, weight: 'bold' },
                    bodyFont: { family: 'Outfit', size: 14 },
                    callbacks: {
                        label: function(context) { return `Score: ${context.raw.toFixed(1)}%`; }
                    }
                }
            }
        }
    });

    let labels = [];
    let dataCounts = [];
    let colors = [];

    Object.keys(emotionCounts).forEach(k => {
        let val = emotionCounts[k];
        if (val === 0) return; 
        labels.push(k);
        dataCounts.push(val);

        const keyLower = k.toLowerCase();
        if(keyLower.includes('neutral')) colors.push('rgba(200, 200, 200, 0.7)');
        else if(keyLower.includes('frustrat') || keyLower.includes('anger') || keyLower.includes('angry')) colors.push('rgba(209, 52, 56, 0.7)');
        else if(keyLower.includes('happy') || keyLower.includes('happiness')) colors.push('rgba(16, 124, 65, 0.7)');
        else if(keyLower.includes('sad') || keyLower.includes('sadness')) colors.push('rgba(0, 120, 212, 0.7)');
        else colors.push('rgba(98, 100, 167, 0.7)');
    });
    
    if (dataCounts.length === 0) {
        labels = ['Neutral']; dataCounts = [1]; colors = ['rgba(200, 200, 200, 0.7)'];
    }

    if (emotionPolarChartInstance) emotionPolarChartInstance.destroy();
    emotionPolarChartInstance = new Chart(document.getElementById('emotionPolarChart'), {
        type: 'polarArea',
        data: {
            labels: labels,
            datasets: [{
                data: dataCounts,
                backgroundColor: colors.map(c => c.replace('0.7', '0.85')),
                hoverBackgroundColor: colors.map(c => c.replace('0.7', '1')),
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 1500,
                easing: 'easeOutQuart'
            },
            cutout: '50%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { family: 'Outfit', size: 12 },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#333',
                    bodyColor: '#666',
                    titleFont: { family: 'Outfit', size: 14 },
                    bodyFont: { family: 'Outfit', size: 13, weight: 'bold' },
                    padding: 12,
                    cornerRadius: 8,
                    borderColor: 'rgba(0,0,0,0.05)',
                    borderWidth: 1
                }
            }
        }
    });

    // Render Distribution Doughnut
    if (performanceDistributionChartInstance) performanceDistributionChartInstance.destroy();
    const distCtx = document.getElementById('performanceDistributionChart');
    if (distCtx) {
        const totalDist = distributionCounts.excellent + distributionCounts.good + distributionCounts.needsImprovement;
        if (totalDist > 0) {
            performanceDistributionChartInstance = new Chart(distCtx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Excellent (90%+)', 'Good (75-89%)', 'Needs Improvement (<75%)'],
                    datasets: [{
                        data: [distributionCounts.excellent, distributionCounts.good, distributionCounts.needsImprovement],
                        backgroundColor: [uiColors.excellent, uiColors.good, uiColors.needsImprovement],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { font: { family: 'Outfit', size: 13 } } }
                    }
                }
            });
        }
    }

    // Render Areas for Improvement Bar Chart
    if (topImprovementAreasChartInstance) topImprovementAreasChartInstance.destroy();
    const impCtx = document.getElementById('topImprovementAreasChart');
    if (impCtx) {
        let subMetricAverages = [];
        Object.keys(subMetricTotals).forEach(key => {
            if (subMetricCounts[key] > 0) {
                subMetricAverages.push({
                    name: key,
                    avg: subMetricTotals[key] / subMetricCounts[key]
                });
            }
        });
        
        subMetricAverages.sort((a, b) => a.avg - b.avg);
        const bottom5 = subMetricAverages.slice(0, 5);
        
        if (bottom5.length > 0) {
            topImprovementAreasChartInstance = new Chart(impCtx.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: bottom5.map(m => m.name),
                    datasets: [{
                        label: 'Avg Score %',
                        data: bottom5.map(m => m.avg),
                        backgroundColor: 'rgba(255, 159, 64, 0.7)',
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { min: 0, max: 100, ticks: { font: { family: 'Outfit' } } },
                        y: { ticks: { font: { family: 'Outfit', size: 11 } } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) { return `Score: ${context.raw.toFixed(1)}%`; }
                            }
                        }
                    }
                }
            });
        }
    }
}

// Upload & Poll Logic
async function startAnalysis() {
    if (!selectedFiles || selectedFiles.length === 0) return showToast("Please select a file to upload.", true);

    // Check if it's a zip file
    const isZip = document.querySelector('input[name="uploadType"]:checked').value === "zip";
    if (isZip || selectedFiles[0].name.toLowerCase().endsWith('.zip')) {
        return startBulkAnalysis();
    }

    unifiedUploadModal.classList.remove("open");

    for (let file of selectedFiles) {
        const topic = file.name.replace(/\.[^/.]+$/, "");
        const formData = new FormData();
        formData.append("file", file);
        formData.append("topic", topic);
        if (analysisAgentName && analysisAgentName.value) {
            formData.append("agent_name", analysisAgentName.value);
        }
        if (analysisAgentName && analysisAgentName.dataset.id) {
            formData.append("agent_id", analysisAgentName.dataset.id);
        }

        progressPanel.classList.add("open");
        progressMessage.textContent = `Uploading ${file.name}...`;
        progressBarFill.style.width = "50%";

        try {
            const res = await fetch("/api/analyze", {
                method: "POST",
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                progressMessage.textContent = `Upload complete (${file.name}). Processing...`;
                progressBarFill.style.width = "100%";
                pollAnalysisStatus(data.session_id);
                await new Promise(r => setTimeout(r, 1000));
            } else if (res.status === 409) {
                const errData = await res.json();
                showToast(`Duplicate Upload: ${errData.message}`, true);
                progressPanel.classList.remove("open");
            } else {
                showToast(`Analysis failed to start for ${file.name}.`, true);
            }
        } catch(e) {
            console.error(e);
            showToast(`Upload error for ${file.name}.`, true);
        }
    }
    setTimeout(() => {
        progressPanel.classList.remove("open");
        progressBarFill.style.width = "0%";
    }, 2000);
}

async function startBulkAnalysis() {
    const formData = new FormData();
    formData.append("file", selectedFiles[0]);
    if (analysisAgentName && analysisAgentName.value) {
        formData.append("agent_name", analysisAgentName.value);
    }
    if (analysisAgentName && analysisAgentName.dataset.id) {
        formData.append("agent_id", analysisAgentName.dataset.id);
    }

    unifiedUploadModal.classList.remove("open");

    progressPanel.classList.add("open");
    progressMessage.textContent = "Uploading batch ZIP file...";
    progressBarFill.style.width = "50%";

    try {
        const response = await fetch("/api/upload/bulk", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Bulk upload failed");
        }

        const data = await response.json();
        progressMessage.textContent = "Batch upload complete. Processing " + data.sessions_created + " files...";
        progressBarFill.style.width = "100%";
        setTimeout(() => progressPanel.classList.remove("open"), 2500);

        if (currentAgentId) {
            selectAgent(currentAgentId, currentAgentName);
        } else {
            loadAgents();
        }
    } catch (err) {
        showToast(err.message, true);
        progressPanel.classList.remove("open");
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
            showToast("Analysis failed.", true);
        }
    }, 2000);
}

function updateProgressBar(msg, pct) {
    progressMessage.textContent = msg;
    progressBarFill.style.width = `${pct}%`;
    progressPercentage.textContent = `${pct}%`;
}

async function deleteCurrentSession() {
    if (!currentSessionId) return showToast("No session selected.", true);
    
    showConfirm("Delete this session?", async () => {
        try {
            const res = await fetch(`/api/sessions/${currentSessionId}`, { method: 'DELETE' });
            if (res.ok) {
                showToast("Session deleted.");
                document.getElementById('readingPaneContent').style.display = 'none';
                currentSessionId = null;
                currentSessionData = null;
                fetchSessions();
            } else {
                showToast("Failed to delete.", true);
            }
        } catch (err) {
            showToast(err.message, true);
        }
    });
}

async function submitNewAgent() {
    if(!newAgentNameInput.value) return showToast("Agent name required.", true);
    
    const idInput = document.getElementById("newAgentIdInput");
    if(!idInput || !idInput.value) return showToast("Agent Email required.", true);
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(idInput.value)) {
        return showToast("Please enter a valid email address.", true);
    }
    
    const locInput = document.getElementById("newAgentLocationInput");
    if(!locInput || !locInput.value) return showToast("Location required.", true);
    
    const depInput = document.getElementById("newAgentDepartmentInput");
    if(!depInput || !depInput.value) return showToast("Department required.", true);

    const formData = new FormData();
    formData.append("agent_name", newAgentNameInput.value);
    formData.append("agent_id", idInput.value);
    formData.append("location", locInput.value);
    formData.append("department", depInput.value);

    try {
        const res = await fetch("/api/agents/add", { method: "POST", body: formData });
        if(res.ok) {
            const data = await res.json();
            if (data.is_duplicate) {
                showToast("Agent with this email already exists.", true);
            } else {
                showToast("Agent added successfully.", false);
            }
            addAgentModal.classList.remove("open");
            addAgentForm.reset();
            loadAgents();
        } else {
            throw new Error("Failed to add agent.");
        }
    } catch(err) {
        showToast("Error adding agent.", true);
    }
}

async function submitEditAgent() {
    const originalId = document.getElementById("editAgentIdOriginal").value;
    const name = document.getElementById("editAgentNameInput").value;
    const newId = document.getElementById("editAgentIdInput").value;
    const loc = document.getElementById("editAgentLocationInput").value;
    const dept = document.getElementById("editAgentDepartmentInput").value;

    const formData = new FormData();
    formData.append("agent_name", name);
    formData.append("new_agent_id", newId);
    formData.append("location", loc);
    formData.append("department", dept);

    try {
        const res = await fetch(`/api/agents/${encodeURIComponent(originalId)}`, { method: "PUT", body: formData });
        const data = await res.json();

        if (data.status === "success") {
            showToast("Agent updated successfully.");
            editAgentModal.classList.remove("open");
            loadAgents(); // Reload list
        } else {
            showToast(data.detail || "Failed to update agent.", true);
        }
    } catch (err) {
        showToast("Error updating agent.", true);
    }
}

async function startBulkAddAgents() {
    if(!selectedBulkFile) return showToast("Select a CSV file.", true);
    const formData = new FormData();
    formData.append("file", selectedBulkFile);

    try {
        const msgBox = document.getElementById("bulkUploadMessage");
        msgBox.style.display = "none";
        msgBox.innerHTML = "";
        
        const res = await fetch("/api/agents/bulk", { method: "POST", body: formData });
        if(res.ok) {
            const data = await res.json();
            bulkAddAgentsForm.reset();
            selectedBulkFile = null;
            document.getElementById("bulkAgentsFileInfo").textContent = "Supports .CSV only";
            loadAgents();
            
            msgBox.style.display = "block";
            let htmlMsg = "";
            if (data.agents_added === 0) {
                htmlMsg = `<div style="color: var(--accent-red); font-weight: bold; margin-bottom: 5px;">0 agents added. All agents were duplicates or invalid.</div>`;
            } else {
                htmlMsg = `<div style="color: var(--outlook-green); font-weight: bold; margin-bottom: 5px;">Successfully added ${data.agents_added} new agent(s).</div>`;
            }
            
            if (data.rejected && data.rejected.length > 0) {
                const csvRows = ["agent_name,agent_email,reason"];
                data.rejected.forEach(r => csvRows.push(`"${r.agent_name}","${r.agent_email}","${r.reason}"`));
                const csvString = csvRows.join("\\n");
                const blob = new Blob([csvString], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                
                htmlMsg += `<div style="margin-top: 8px;">${data.rejected.length} agent(s) were rejected. <a href="${url}" download="rejected_agents.csv" class="fluent-link" style="color: var(--outlook-blue); font-weight: bold;">Download Reject Report (CSV)</a></div>`;
            }
            
            msgBox.innerHTML = htmlMsg;
        } else {
            throw new Error("Failed to bulk add agents.");
        }
    } catch(err) {
        showToast(err.message, true);
    }
}

// Make Modals Draggable
function makeDraggable(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const content = modal.querySelector('.modal-content');
    const header = modal.querySelector('.modal-header');
    if (!content || !header) return;

    header.style.cursor = 'move';
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = content.getBoundingClientRect();
        // Position relative to viewport
        initialX = rect.left;
        initialY = rect.top;
        
        // Switch to absolute positioning if not already
        if (content.style.position !== 'absolute') {
            content.style.position = 'absolute';
            content.style.left = initialX + 'px';
            content.style.top = initialY + 'px';
            content.style.transform = 'none'; // Clear any centering transforms
            content.style.margin = '0'; // Clear auto margins
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        content.style.left = (initialX + dx) + 'px';
        content.style.top = (initialY + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Apply draggability
makeDraggable('addAgentModal');
makeDraggable('editAgentModal');
makeDraggable('analyticsModal');
makeDraggable('unifiedUploadModal');

window.deleteAgent = async function(event, agentId) {
    event.stopPropagation();
    showConfirm("Are you sure you want to mark this agent as deleted? This will disable audio uploads for them.", async () => {
        try {
            const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
            if (res.ok) {
                showToast("Agent deleted.");
                loadAgents();
            } else {
                showToast("Failed to delete agent.", true);
            }
        } catch(e) {
            showToast("Failed to delete agent.", true);
        }
    });
};

window.openEditAgentModal = function(event, agentId) {
    event.stopPropagation();
    const agent = window.globalAgentsList?.find(a => a.agent_id === agentId);
    if (!agent) return;
    
    document.getElementById("editAgentIdOriginal").value = agent.agent_id;
    document.getElementById("editAgentNameInput").value = agent.agent_name || "";
    document.getElementById("editAgentIdInput").value = agent.agent_id || "";
    document.getElementById("editAgentLocationInput").value = agent.location || "";
    document.getElementById("editAgentDepartmentInput").value = agent.department || "";
    editAgentModal.classList.add("open");
};

window.restoreAgent = async function(event, agentId) {
    event.stopPropagation();
    try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/restore`, { method: "POST" });
        if (res.ok) {
            showToast("Agent restored.");
            loadAgents();
        } else {
            showToast("Failed to restore agent.", true);
        }
    } catch(e) {
        showToast("Failed to restore agent.", true);
    }
};
