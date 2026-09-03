// ============================================================================
// 达妙 DM4310 一体化关节电机 · CAN 协议层（纯数学，平台无关，可在 PC 端单元测试）
//
// 帧格式遵循达妙《DM 系列电机使用手册》的 MIT 运控模式：
//   控制帧(8字节): 位置16bit + 速度12bit + KP12bit + KD12bit + 前馈力矩12bit
//   反馈帧(8字节): ID低8bit | 故障码高4bit+ID高4bit | 位置16bit | 速度16bit | 力矩16bit
//   特殊命令: 使能FC 失能FD 置零FE 清故障FB（前7字节0xFF）
//
// 注意: P_MAX/V_MAX/T_MAX 因电机型号与固件批次可能不同，
//       务必用达妙上位机核对后修改 range_dm4310()。
// ============================================================================
#pragma once
#include <stdint.h>

namespace dm4310 {

struct Range {
  float p_max;    // rad
  float v_max;    // rad/s
  float t_max;    // N*m
  float kp_max;   // N*m/rad
  float kd_max;   // N*m*s/rad
};

inline Range range_dm4310() {
  Range r;
  r.p_max  = 12.5f;
  r.v_max  = 30.0f;
  r.t_max  = 10.0f;
  r.kp_max = 500.0f;
  r.kd_max = 100.0f;
  return r;
}

inline uint16_t float_to_uint(float x, float x_min, float x_max, uint8_t bits) {
  float span = x_max - x_min;
  if (x > x_max) x = x_max;
  else if (x < x_min) x = x_min;
  return (uint16_t)((x - x_min) * ((float)((1u << bits) - 1u)) / span);
}

inline float uint_to_float(uint16_t x_int, float x_min, float x_max, uint8_t bits) {
  float span = x_max - x_min;
  return ((float)x_int) * span / ((float)((1u << bits) - 1u)) + x_min;
}

inline void pack_mit(const Range& rg, float p, float v, float kp, float kd,
                     float t_ff, uint8_t out[8]) {
  uint16_t pi  = float_to_uint(p,   -rg.p_max,  rg.p_max,  16);
  uint16_t vi  = float_to_uint(v,   -rg.v_max,  rg.v_max,  12);
  uint16_t kpi = float_to_uint(kp,   0.0f,      rg.kp_max, 12);
  uint16_t kdi = float_to_uint(kd,   0.0f,      rg.kd_max, 12);
  uint16_t ti  = float_to_uint(t_ff,-rg.t_max,  rg.t_max,  12);
  out[0] = (uint8_t)(pi >> 8);
  out[1] = (uint8_t)(pi & 0xFF);
  out[2] = (uint8_t)(vi >> 4);
  out[3] = (uint8_t)(((vi & 0xF) << 4) | (kpi >> 8));
  out[4] = (uint8_t)(kpi & 0xFF);
  out[5] = (uint8_t)(kdi >> 4);
  out[6] = (uint8_t)(((kdi & 0xF) << 4) | (ti >> 8));
  out[7] = (uint8_t)(ti & 0xFF);
}

struct Feedback {
  uint16_t id;    // 反馈的电机 CAN_ID（标准帧 11bit）
  uint8_t err;    // 故障码: 0正常 8过压 9欠压 A过流 B MOS过温 C线圈过温 D通讯丢失 E过载
  float   p;      // rad（电机输出轴）
  float   v;      // rad/s
  float   t;      // N*m
};

inline void unpack_feedback(const Range& rg, const uint8_t d[8], Feedback& fb) {
  fb.id  = (uint16_t)(d[0] | ((d[1] & 0x0F) << 8));
  fb.err = (uint8_t)(d[1] >> 4);
  fb.p = uint_to_float((uint16_t)((d[2] << 8) | d[3]), -rg.p_max, rg.p_max, 16);
  fb.v = uint_to_float((uint16_t)((d[4] << 8) | d[5]), -rg.v_max, rg.v_max, 16);
  fb.t = uint_to_float((uint16_t)((d[6] << 8) | d[7]), -rg.t_max, rg.t_max, 16);
}

inline void pack_special(uint8_t cmd, uint8_t out[8]) {
  for (int i = 0; i < 7; ++i) out[i] = 0xFF;
  out[7] = cmd;
}

inline void pack_enable(uint8_t o[8])    { pack_special(0xFC, o); }
inline void pack_disable(uint8_t o[8])   { pack_special(0xFD, o); }
inline void pack_set_zero(uint8_t o[8])  { pack_special(0xFE, o); }
inline void pack_clear_err(uint8_t o[8]) { pack_special(0xFB, o); }

inline const char* error_name(uint8_t err) {
  switch (err) {
    case 0x0: return "OK";
    case 0x8: return "OVER_VOLT";
    case 0x9: return "UNDER_VOLT";
    case 0xA: return "OVER_CURRENT";
    case 0xB: return "MOS_OVER_TEMP";
    case 0xC: return "COIL_OVER_TEMP";
    case 0xD: return "LOST_FRAME";
    case 0xE: return "OVERLOAD";
    default:  return "UNKNOWN";
  }
}

} // namespace dm4310