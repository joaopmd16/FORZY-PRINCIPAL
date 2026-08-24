/*
 * i2c_scanner_devkit.ino
 *
 * Diagnóstico: varre o barramento I2C nos pinos do ESP32 Dev Kit V1
 * (SDA=GPIO19, SCL=GPIO18) e imprime todo endereço que responder.
 *
 * Uso: flashar, abrir Serial Monitor a 115200 baud.
 *   - Nenhum endereço encontrado → problema de fiação/alimentação.
 *   - Endereço 0x68 → ajustar esp32_devkit_mpu6050_rms.ino para MPU6050 mpu(0x68).
 *   - Endereço 0x69 → o código atual (0x69) já está certo, o problema é outro.
 */

#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(19, 18); // SDA=GPIO19, SCL=GPIO18
  Serial.println("Scanner I2C iniciado (SDA=19, SCL=18)...");
}

void loop() {
  byte count = 0;
  Serial.println("Varrendo...");

  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    byte err = Wire.endTransmission();

    if (err == 0) {
      Serial.print("Dispositivo encontrado em 0x");
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      count++;
    }
  }

  if (count == 0) {
    Serial.println("Nenhum dispositivo encontrado. Verifique fiação (VCC/GND/SDA/SCL) e alimentação (3.3V).");
  } else {
    Serial.print(count);
    Serial.println(" dispositivo(s) encontrado(s).");
  }

  delay(3000);
}
