// ============================================================================
// 达妙 DM4310 · ESP32 TWAI(CAN) 总线层（header-only，仅 ESP32 Arduino 核心可用）
// 默认 1 Mbps，与达妙电机出厂 CAN 波特率一致；若上位机里改过波特率需同步修改。
// ============================================================================
#pragma once
#include <Arduino.h>
#include <string.h>
#include "driver/twai.h"
#include "dm4310_protocol.h"

namespace dm4310 {

inline bool bus_begin(gpio_num_t tx_pin, gpio_num_t rx_pin) {
  twai_general_config_t gc = TWAI_GENERAL_CONFIG_DEFAULT(tx_pin, rx_pin, TWAI_MODE_NORMAL);
  twai_timing_config_t tc = TWAI_TIMING_CONFIG_1MBITS();
  twai_filter_config_t fc = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&gc, &tc, &fc) != ESP_OK) return false;
  return twai_start() == ESP_OK;
}

inline bool bus_send_frame(uint32_t can_id, const uint8_t data[8]) {
  twai_message_t msg;
  memset(&msg, 0, sizeof(msg));
  msg.identifier = can_id;
  msg.data_length_code = 8;
  memcpy(msg.data, data, 8);
  return twai_transmit(&msg, pdMS_TO_TICKS(20)) == ESP_OK;
}

inline bool bus_receive(twai_message_t& msg, uint32_t timeout_ms) {
  return twai_receive(&msg, pdMS_TO_TICKS(timeout_ms)) == ESP_OK;
}

} // namespace dm4310