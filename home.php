<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <title>AnalyChecks</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="style/home.css">
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@1.2.0/dist/chartjs-chart-matrix.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js"></script>
</head>
<body>
    <?php
    session_start();
    if (isset($_SESSION['username'])) {
        $username = $_SESSION['username'];
    } else {
        $_SESSION['error'] = "Login required";
        header("Location: index.php");
        exit();
    }
    ?>
    <div class="card welcome">
        <img src="image/logo-img.png" class="logo">
        <div class="col">
            <div class="top">
                <h2>Hello, <?php echo $username; ?>! Ready to analyze your data with <img src="image/logo-text.png" class="logo text">?</h2>
                <img src="image/logout.png" class="icon" onclick="logout()" title="Logout">
            </div>
            <p class="small">Please select one or more CSV / Excel files you want to analyze. Please make sure your table/s have COLUMN NAMES, PRIMARY KEYS and/or FOREIGN KEYS.</p>
            <input id="fileinput" type="file" accept=".csv, .xlsx, .xls" multiple />
            <button id="btnUpload" class="btn upload">Upload File</button>
            <div id="status" style="margin-top:12px;"></div>
        </div>
    </div>

    <div id="result" class="card" style="display:none;">
        <h3>📋 Upload result</h3>
        <div id="meta"></div>
    </div>

    <div id="globalSummary" class="card" style="display: none;">
        <h3>📈 Global Summary</h3>
        <div class="summary-box"></div>
        <div id="summary-insight-box" class="insight-box" style="display:none;">
            🧠 AI Insight<p id="summary-insight" class="summary insight">Getting insights ...</p>
        </div>
    </div>

    <div id="correlationMatrix" class="card" style="display: none;">
        <h3>🧮 Correlation Matrix</h3>
        <div class="matrix-box"></div>
        <div id="correlation-insight-box" class="insight-box" style="display:none;">
            🧠 AI Insight<p id="correlation-insight" class="correlation insight">Getting insights ...</p>
        </div>
    </div>

    <div id="graphCard" class="card" style="display:none;">
        <h3>📊 Data Analysis (Charts)</h3>
        <p class="small">Choose X and Y axes from your table columns:</p>
        <div class="axis-options">
            <label>
                <input type="checkbox" id="showAllColumns">
                Show all columns
            </label>
        </div>
        <div class="axis-selection" style="margin-bottom:10px;">
            <div class="label-select">
                <div class="select-box">
                    <p>X-axis:</p>
                    <select id="xAxis"></select>
                </div>
            </div>
            <div class="label-select yAxis">
                <div class="select-box">
                    <p>Y-axis:<br><span class="yAxis-hint">Hold Ctrl(Win)/<br>Cmd(Mac) to<br>select multiple</span></p>
                    <select id="yAxis" multiple size="5"></select>
                </div>
            </div>
            <div class="label-select type">
                <div class="select-box">
                    <p>Chart type:</p>
                    <select id="chartType">
                        <option value="bar">Bar</option>
                        <option value="line">Line</option>
                        <option value="pie">Pie</option>
                    </select>
                </div>
            </div>
            <div class="button-box">
                <button id="btnDraw" class="btn">Analyze</button>
            </div>
            <div class="chart-actions">
                <button id="btnDownloadPNG" class="download-btn" disabled>🖼️ Download PNG</button>
                <button id="btnDownloadPDF" class="download-btn" disabled>📄 Download PDF</button>
            </div>
        </div>
        <p class="invalid" id="invalid-relation" style="display: none;">INVALID DATA RELATION</p>
        <canvas id="chartCanvas" style="display: none;"></canvas>
        <div id="chart-insight-box" class="insight-box" style="display:none;">
            🧠 AI Insight<p id="chart-insight" class="chart insight">Getting insights ...</p>
        </div>
    </div>

    <div id="predictCard" class="card" style="display:none;">
        <h3>🔮 Predictive Analysis</h3>
        <p class="small">Choose X and Y axes from your table columns:</p>
        <div class="predict-axis-selection" style="margin-bottom:10px;">
            <div class="label-select">
                <div class="select-box">
                    <p>X-axis:</p>
                    <select id="predictX"></select>
                </div>
            </div>
            <div class="label-select">
                <div class="select-box">
                    <p>Y-axis:<br><span class="yAxis-hint">Hold Ctrl(Win)/<br>Cmd(Mac) to<br>select multiple</span></p>
                    <select id="predictY" multiple size="5"></select>
                </div>
            </div>
            <div class="label-select type">
                <div class="select-box">
                    <p>Chart type:</p>
                    <select id="predictChartType">
                        <option value="line">Line</option>
                        <option value="bar">Bar</option>
                    </select>
                </div>
            </div>
            <div class="button-box">
                <button id="btnPredict" class="btn">Predict</button>
            </div>
            <div class="predict-actions">
                <button id="predictBtnDownloadPNG" class="download-btn" disabled>🖼️ Download PNG</button>
                <button id="predictBtnDownloadPDF" class="download-btn" disabled>📄 Download PDF</button>
            </div>
        </div>
        <p class="predict-invalid" id="predict-invalid-relation" style="display: none;">INVALID DATA RELATION</p>
        <canvas id="predictChartCanvas" style="display: none;"></canvas>
        <div id="predict-insight-box" class="insight-box" style="display:none;">
            🧠 AI Insight<p id="predict-insight" class="predict insight">Getting insights ...</p>
        </div>
    </div>

    <div id="reportCard" class="card" style="display:none;">
        <h3>📄 Export Report</h3>
        <button id="btnGenerateReport" class="btn" disabled>Generate Report (PDF)</button>
        <p class="small" id="reportStatus"></p>
    </div>
    
    <script src="script/home.js"></script>
</body>
</html>