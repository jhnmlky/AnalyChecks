<?php
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');
require_once __DIR__ . '/config.php';

$apiKey = getenv('OPENAI_API_KEY') ?: OPENAI_API_KEY ?? null;

if (!$apiKey) {
    echo json_encode(['error' => 'Missing OpenAI API key']);
    exit;
}

$summary = $_POST['summary'] ?? '';
$correlation = $_POST['correlation'] ?? '';
$x = $_POST['x'] ?? '';
$series = $_POST['series'] ?? '';
$predictSeries = $_POST['predictSeries'] ?? '';

if (is_string($x)) {
    $xData = json_decode($x, true);
    if (json_last_error() === JSON_ERROR_NONE) $x = implode(', ', $xData);
}

if (is_string($series)) {
    $seriesData = json_decode($series, true);
    if (json_last_error() === JSON_ERROR_NONE) {
        $formattedSeries = [];
        foreach ($seriesData as $s) {
            $label = $s['label'] ?? 'Series';
            $vals = implode(', ', $s['data'] ?? []);
            $formattedSeries[] = "$label: [$vals]";
        }
        $series = implode("\n", $formattedSeries);
    }
}

if (is_string($predictSeries)) {
    $predictData = json_decode($predictSeries, true);
    if (json_last_error() === JSON_ERROR_NONE && is_array($predictData)) {
        $formattedPredict = [];
        foreach ($predictData as $p) {
            $label = $p['label'] ?? 'Predicted';
            $slope = $p['slope'] ?? 'n/a';
            $intercept = $p['intercept'] ?? 'n/a';
            $r2 = $p['r2'] ?? 'n/a';
            $predicted = implode(', ', $p['predicted'] ?? []);
            $original = implode(', ', $p['original'] ?? []);
            $formattedPredict[] = "$label → slope=$slope, intercept=$intercept, r2=$r2\n"
                                . "predicted: [$predicted]\n"
                                . "original: [$original]";
        }
        $predictSeries = implode("\n\n", $formattedPredict);
    }
}

if ($summary) {
    $prompt = "You are a data analyst. Write a 2-3 sentence summary describing the dataset trends based only on the following column summary statistics:\n\n"
            . "Summary Data:\n$summary\n\n"
            . "Avoid using non-ASCII symbols on your response.";
} elseif ($correlation) {
    $prompt = "You are a data analyst. Write a short paragraph explaining the relationships between columns based on these correlations:\n\n"
            . "Correlation Matrix:\n$correlation\n\n"
            . "Avoid using non-ASCII symbols on your response.";
} elseif ($x && $series) {
    $prompt = "You are a data analyst. Write a 2-3 sentence description of trends, relationships, or insights observed from this chart data:\n\n"
            . "X values:\n$x\n\n"
            . "Series (Y values):\n$series\n\n"
            . "Avoid using non-ASCII symbols on your response.";
} elseif ($x && $predictSeries) {
    $prompt = "You are a data analyst. Write a 2-3 sentence description of regression analysis observed from this chart data:\n\n"
            . "X values:\n$x\n\n"
            . "Series (Y values):\n$predictSeries\n\n"
            . "Avoid using non-ASCII symbols on your response.";
} else {
    echo json_encode(['error' => 'No valid input received']);
    exit;
}

$ch = curl_init('https://api.openai.com/v1/responses');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer $apiKey",
        "Content-Type: application/json"
    ],
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode([
        "model" => "gpt-5-mini",
        "reasoning" => [ "effort" => "medium" ],
        "input" => [
            [
                "role" => "developer",
                "content" => "You are an expert data analyst who writes short, readable summaries of datasets and charts."
            ],
            [
                "role" => "user",
                "content" => $prompt
            ]
        ]
    ])
]);

$response = curl_exec($ch);

if (curl_errno($ch)) {
    echo json_encode(['error' => 'cURL error: ' . curl_error($ch)]);
    exit;
}

$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200) {
    echo json_encode(['error' => "OpenAI API returned HTTP $httpCode", 'response' => $response]);
    exit;
}

$data = json_decode($response, true);

if (isset($data['error'])) {
    echo json_encode(['error' => 'OpenAI API error: ' . $data['error']['message']]);
    exit;
}

$insight = null;
if (!empty($data['output'])) {
    foreach ($data['output'] as $item) {
        if (!empty($item['content'])) {
            foreach ($item['content'] as $content) {
                if (isset($content['text'])) {
                    $insight = $content['text'];
                    break 2;
                }
            }
        }
    }
}

if (!$insight && isset($data['text'])) {
    $insight = $data['text'];
}

if (!$insight) {
    $insight = 'No insights generated.';
}

echo json_encode(['insight' => $insight], JSON_UNESCAPED_UNICODE);