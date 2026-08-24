// Biblioteca de comunicação I2C
#include <Wire.h>

// Biblioteca do sensor MPU6050
#include <MPU6050.h>

// Cria o objeto do sensor
MPU6050 mpu;

// Variáveis para armazenar os valores brutos do acelerômetro
int16_t ax_raw, ay_raw, az_raw;

// Variáveis para armazenar os valores brutos do giroscópio
int16_t gx_raw, gy_raw, gz_raw;

// Variáveis para armazenar a aceleração convertida em g
float ax, ay, az;

// Variáveis para armazenar a velocidade angular em graus por segundo
float gx, gy, gz;

void setup()
{
  // Inicializa comunicação serial
  Serial.begin(115200);

  // Inicializa barramento I2C
  Wire.begin();

  // Inicializa o sensor
  mpu.initialize();

  // Ajusta a escala do acelerômetro para ±4g
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_4);

  // Ajusta a escala do giroscópio para ±250°/s
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);

  // Verifica se o sensor foi conectado corretamente
  if (mpu.testConnection())
  {
    Serial.println("MPU6050 conectado com sucesso");
  }
  else
  {
    Serial.println("Erro ao conectar com o MPU6050");
  }
}

void loop()
{
  // Lê os valores do acelerômetro e giroscópio
  mpu.getMotion6(&ax_raw, &ay_raw, &az_raw, &gx_raw, &gy_raw, &gz_raw);

  // ===================== ACELERÔMETRO =====================

  // Converte os valores para gravidade (g)
  ax = ax_raw / 8192.0;
  ay = ay_raw / 8192.0;
  az = az_raw / 8192.0;

  // ===================== GIROSCÓPIO =====================

  // Converte os valores para graus por segundo (°/s)
  gx = gx_raw / 131.0;
  gy = gy_raw / 131.0;
  gz = gz_raw / 131.0;

  // ===================== SAÍDA SERIAL =====================

  // Acelerômetro
  Serial.print("AX (g): ");
  Serial.print(ax, 3);

  Serial.print(" | AY (g): ");
  Serial.print(ay, 3);

  Serial.print(" | AZ (g): ");
  Serial.print(az, 3);

  // Giroscópio
  Serial.print(" || GX (°/s): ");
  Serial.print(gx, 3);

  Serial.print(" | GY (°/s): ");
  Serial.print(gy, 3);

  Serial.print(" | GZ (°/s): ");
  Serial.println(gz, 3);

  // Intervalo entre leituras
  delay(200);
}