/*
 * esp32_mpu6050_rms.ino
 *
 * Amostragem a 200 Hz, janela de 1 s.
 * Calcula RMS removendo componente DC (gravidade) de cada eixo.
 * Estima frequência dominante por contagem de zero-crossings.
 * Envia JSON via Serial a ~1 Hz.
 *
 * Dependências (Library Manager):
 *   - ElectronicCats/MPU6050  (ou jrowberg/i2cdevlib MPU6050)
 *   - arduinoFFT  (opcional — habilite #define USE_FFT abaixo)
 *
 * Conexões ESP32-CAM AI Thinker ↔ MPU6050:
 *   3.3V → VCC,  GND → GND,  GPIO21 → SDA,  GPIO22 → SCL
 */

#include <Wire.h>
#include <MPU6050.h>

// #define USE_FFT   // descomente para usar arduinoFFT (mais preciso)

#ifdef USE_FFT
  #include <arduinoFFT.h>
#endif

// ── Configurações ──────────────────────────────────────────────────────────────
static const uint16_t SAMPLE_RATE_HZ = 200;
static const uint16_t WINDOW_SAMPLES  = 200;   // 1 s
static const uint32_t SAMPLE_US       = 1000000UL / SAMPLE_RATE_HZ;

// ── Objetos globais ────────────────────────────────────────────────────────────
MPU6050 mpu;

// Buffers de amostras (mag aceleração sem DC)
float buf_ax[WINDOW_SAMPLES];
float buf_ay[WINDOW_SAMPLES];
float buf_az[WINDOW_SAMPLES];
float buf_mag[WINDOW_SAMPLES];
float buf_gx[WINDOW_SAMPLES];
float buf_gy[WINDOW_SAMPLES];
float buf_gz[WINDOW_SAMPLES];

#ifdef USE_FFT
  double vReal[WINDOW_SAMPLES];
  double vImag[WINDOW_SAMPLES];
  ArduinoFFT<double> FFT(vReal, vImag, WINDOW_SAMPLES, (double)SAMPLE_RATE_HZ);
#endif

// ── Helpers ────────────────────────────────────────────────────────────────────
float calcRms(float* buf, uint16_t n) {
  float sum = 0;
  for (uint16_t i = 0; i < n; i++) sum += buf[i] * buf[i];
  return sqrt(sum / n);
}

float calcMean(float* buf, uint16_t n) {
  float s = 0;
  for (uint16_t i = 0; i < n; i++) s += buf[i];
  return s / n;
}

// Zero-crossing rate → frequência estimada
float zeroCrossingFreq(float* buf, uint16_t n) {
  uint16_t crossings = 0;
  for (uint16_t i = 1; i < n; i++) {
    if ((buf[i - 1] < 0) != (buf[i] < 0)) crossings++;
  }
  // crossings/2 = ciclos completos na janela de 1 s
  return crossings / 2.0f;
}

#ifdef USE_FFT
float fftDominantFreq(float* buf, uint16_t n) {
  for (uint16_t i = 0; i < n; i++) {
    vReal[i] = buf[i];
    vImag[i] = 0;
  }
  FFT.windowing(FFT_WIN_TYP_HANN, FFT_FORWARD);
  FFT.compute(FFT_FORWARD);
  FFT.complexToMagnitude();
  return (float)FFT.majorPeak();
}
#endif

// ── Setup ──────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);  // SDA=GPIO21, SCL=GPIO22 (explícito para ESP32-CAM)
  mpu.initialize();
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_4);   // ±4g → LSB = 8192
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);   // ±250°/s → LSB = 131

  // DLPF 42 Hz → permite capturar até ~21 Hz de vibração sem aliasing
  mpu.setDLPFMode(MPU6050_DLPF_BW_42);

  if (!mpu.testConnection()) {
    while (true) {
      Serial.println("{\"error\":\"MPU6050 nao encontrado\"}");
      delay(1000);
    }
  }
}

// ── Loop ───────────────────────────────────────────────────────────────────────
void loop() {
  // 1. Coleta WINDOW_SAMPLES amostras a SAMPLE_RATE_HZ
  float dc_ax = 0, dc_ay = 0, dc_az = 0;
  float dc_gx = 0, dc_gy = 0, dc_gz = 0;

  for (uint16_t i = 0; i < WINDOW_SAMPLES; i++) {
    uint32_t t0 = micros();

    int16_t raw_ax, raw_ay, raw_az, raw_gx, raw_gy, raw_gz;
    mpu.getMotion6(&raw_ax, &raw_ay, &raw_az, &raw_gx, &raw_gy, &raw_gz);

    buf_ax[i] = raw_ax / 8192.0f;
    buf_ay[i] = raw_ay / 8192.0f;
    buf_az[i] = raw_az / 8192.0f;
    buf_gx[i] = raw_gx / 131.0f;
    buf_gy[i] = raw_gy / 131.0f;
    buf_gz[i] = raw_gz / 131.0f;

    dc_ax += buf_ax[i];
    dc_ay += buf_ay[i];
    dc_az += buf_az[i];
    dc_gx += buf_gx[i];
    dc_gy += buf_gy[i];
    dc_gz += buf_gz[i];

    // Timing preciso
    while ((micros() - t0) < SAMPLE_US) { /* busy wait */ }
  }

  // 2. Remove DC (gravidade) de cada eixo
  dc_ax /= WINDOW_SAMPLES; dc_ay /= WINDOW_SAMPLES; dc_az /= WINDOW_SAMPLES;
  dc_gx /= WINDOW_SAMPLES; dc_gy /= WINDOW_SAMPLES; dc_gz /= WINDOW_SAMPLES;

  for (uint16_t i = 0; i < WINDOW_SAMPLES; i++) {
    buf_ax[i] -= dc_ax;
    buf_ay[i] -= dc_ay;
    buf_az[i] -= dc_az;
    buf_gx[i] -= dc_gx;
    buf_gy[i] -= dc_gy;
    buf_gz[i] -= dc_gz;

    // Magnitude vetorial sem DC
    buf_mag[i] = sqrt(buf_ax[i]*buf_ax[i] + buf_ay[i]*buf_ay[i] + buf_az[i]*buf_az[i]);
  }

  // 3. Calcula RMS e frequência
  float ax_rms  = calcRms(buf_ax, WINDOW_SAMPLES);
  float ay_rms  = calcRms(buf_ay, WINDOW_SAMPLES);
  float az_rms  = calcRms(buf_az, WINDOW_SAMPLES);
  float mag_rms = calcRms(buf_mag, WINDOW_SAMPLES);
  float gx_rms  = calcRms(buf_gx, WINDOW_SAMPLES);
  float gy_rms  = calcRms(buf_gy, WINDOW_SAMPLES);
  float gz_rms  = calcRms(buf_gz, WINDOW_SAMPLES);

#ifdef USE_FFT
  float freq_hz = fftDominantFreq(buf_mag, WINDOW_SAMPLES);
  float peak2   = 0;  // segundo harmônico via FFT não implementado aqui
#else
  float freq_hz = zeroCrossingFreq(buf_mag, WINDOW_SAMPLES);
  float peak2   = freq_hz * 2.0f;
#endif

  // Temperatura interna do MPU6050 (°C)
  float temp_c = (mpu.getTemperature() / 340.0f) + 36.53f;

  // 4. Emite JSON
  Serial.print("{");
  Serial.print("\"ax_rms\":"); Serial.print(ax_rms, 6); Serial.print(",");
  Serial.print("\"ay_rms\":"); Serial.print(ay_rms, 6); Serial.print(",");
  Serial.print("\"az_rms\":"); Serial.print(az_rms, 6); Serial.print(",");
  Serial.print("\"mag_rms\":"); Serial.print(mag_rms, 6); Serial.print(",");
  Serial.print("\"freq_hz\":"); Serial.print(freq_hz, 2); Serial.print(",");
  Serial.print("\"peaks\":["); Serial.print(freq_hz, 1); Serial.print(",");
                               Serial.print(peak2, 1); Serial.print("],");
  Serial.print("\"temp_c\":"); Serial.print(temp_c, 2); Serial.print(",");
  Serial.print("\"gx_rms\":"); Serial.print(gx_rms, 6); Serial.print(",");
  Serial.print("\"gy_rms\":"); Serial.print(gy_rms, 6); Serial.print(",");
  Serial.print("\"gz_rms\":"); Serial.print(gz_rms, 6);
  Serial.println("}");
}
