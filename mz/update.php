<?php
// Simple same-origin proxy for /update to avoid mixed content or CORS.
// Forwards JSON POST body to the upstream server.
// Configure upstream via UPSTREAM_URL or default to http://localhost:42666/update
$upstream = getenv('UPSTREAM_URL');
if (!$upstream) {
  $upstream = 'http://localhost:42666/update';
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  http_response_code(204);
  exit;
}
if ($method !== 'POST') {
  http_response_code(404);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'not_found']);
  exit;
}

$input = file_get_contents('php://input');
$ch = curl_init($upstream);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Content-Type: application/json',
  'Content-Length: ' . strlen($input)
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 5);
// If upstream is HTTPS with self-signed certs, allow insecure (optional; uncomment next two lines)
// curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
// curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
$response = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($response === false) {
  http_response_code(502);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'bad_gateway', 'detail' => $err]);
  exit;
}
http_response_code($code ?: 200);
header('Content-Type: application/json');
echo $response;
