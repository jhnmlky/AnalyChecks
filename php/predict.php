<?php
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');

$xRaw = $_POST['x'] ?? null;
$seriesRaw = $_POST['series'] ?? null;

function ensure_array($value) {
    if (is_null($value)) return [];
    if (is_array($value)) return $value;
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            return $decoded;
        }
        $trimmed = trim($value);
        if ($trimmed === '') return [];
        $parts = array_map('trim', explode(',', $trimmed));
        return $parts;
    }
    return (array)$value;
}

$xArray = ensure_array($xRaw);
$seriesArray = ensure_array($seriesRaw);

$normalizedSeries = [];
foreach ($seriesArray as $item) {
    if (is_string($item)) {
        $tmp = json_decode($item, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($tmp)) {
            $item = $tmp;
        } else {
            $vals = array_map('trim', explode(',', $item));
            $normalizedSeries[] = [
                'label' => 'Series',
                'data' => array_map(function($v){
                    return is_numeric($v) ? (strpos((string)$v,'.')===false ? (int)$v : (float)$v) : $v;
                }, array_values(array_filter($vals, fn($x)=>$x!=='')))
            ];
            continue;
        }
    }

    $label = isset($item['label']) ? str_replace('.', ': ', (string)$item['label']) : 'Series';
    $dataRaw = $item['data'] ?? $item['values'] ?? [];
    if (is_string($dataRaw)) {
        $maybe = json_decode($dataRaw, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($maybe)) $dataRaw = $maybe;
        else $dataRaw = array_map('trim', explode(',', $dataRaw));
    }

    $dataArray = ensure_array($dataRaw);
    $data = array_map(function($v) {
        if (is_numeric($v)) {
            return (strpos((string)$v, '.') === false) ? (int)$v : (float)$v;
        }
        return $v;
    }, $dataArray);

    $normalizedSeries[] = [
        'label' => $label,
        'data' => array_values($data)
    ];
}

$xNum = [];
foreach ($xArray as $v) {
    if (is_numeric($v)) $xNum[] = (float)$v;
    else {
        $xNum = null;
        break;
    }
}
if ($xNum === null) {
    $xNum = [];
    for ($i=0;$i<count($xArray);$i++) $xNum[] = (float)$i;
}

function linear_regression(array $x, array $y) {
    $n = count($x);
    if ($n !== count($y) || $n < 2) return null;
    $meanX = array_sum($x)/$n;
    $meanY = array_sum($y)/$n;

    $num = 0.0; $den = 0.0;
    for ($i=0;$i<$n;$i++){
        $dx = $x[$i] - $meanX;
        $dy = $y[$i] - $meanY;
        $num += $dx * $dy;
        $den += $dx * $dx;
    }
    $slope = ($den != 0.0) ? ($num / $den) : 0.0;
    $intercept = $meanY - $slope * $meanX;

    $ssTot = 0.0; $ssRes = 0.0;
    for ($i=0;$i<$n;$i++){
        $pred = $intercept + $slope * $x[$i];
        $ssTot += ($y[$i] - $meanY) ** 2;
        $ssRes += ($y[$i] - $pred) ** 2;
    }
    $r2 = ($ssTot != 0.0) ? (1.0 - ($ssRes/$ssTot)) : 0.0;

    $predicted = [];
    for ($i=0;$i<$n;$i++){
        $predicted[] = $intercept + $slope * $x[$i];
    }

    return [
        'slope' => $slope,
        'intercept' => $intercept,
        'r2' => $r2,
        'predicted' => $predicted
    ];
}

$outSeries = [];
foreach ($normalizedSeries as $s) {
    $label = $s['label'] ?? 'series';
    $rawY = $s['data'] ?? [];
    $yNum = [];
    foreach ($rawY as $v) {
        if (is_numeric($v)) $yNum[] = (float)$v;
        else $yNum[] = null;
    }
    $n = min(count($xNum), count($yNum));
    if ($n < 2) {
        $outSeries[] = [
            'label' => $label,
            'slope' => null,
            'intercept' => null,
            'r2' => null,
            'predicted' => array_fill(0, max(count($xNum), count($yNum)), null),
            'original' => $rawY
        ];
        continue;
    }

    $xA = array_slice($xNum, 0, $n);
    $yA = array_slice($yNum, 0, $n);

    $fx = []; $fy = [];
    for ($i=0;$i<$n;$i++){
        if ($yA[$i] === null) continue;
        $fx[] = $xA[$i];
        $fy[] = $yA[$i];
    }
    if (count($fx) < 2) {
        $outSeries[] = [
            'label' => $label,
            'slope' => null,
            'intercept' => null,
            'r2' => null,
            'predicted' => array_fill(0, count($xNum), null),
            'original' => $rawY
        ];
        continue;
    }

    $res = linear_regression($fx, $fy);
    if (!$res) {
        $outSeries[] = [
            'label' => $label,
            'slope' => null,
            'intercept' => null,
            'r2' => null,
            'predicted' => array_fill(0, count($xNum), null),
            'original' => $rawY
        ];
        continue;
    }

    $predAll = [];
    foreach ($xNum as $xx) $predAll[] = $res['intercept'] + $res['slope'] * $xx;

    $outSeries[] = [
        'label' => $label,
        'slope' => $res['slope'],
        'intercept' => $res['intercept'],
        'r2' => $res['r2'],
        'predicted' => $predAll,
        'original' => $rawY
    ];
}

echo json_encode(['series' => $outSeries], JSON_UNESCAPED_UNICODE);