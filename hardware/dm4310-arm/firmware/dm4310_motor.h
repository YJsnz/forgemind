// ============================================================================
// 达妙 DM4310 · 关节封装（header-only）
// 每个物理关节 = 一颗电机 + 方向符号 dir(+1/-1)。
// 所有对外角度均为"关节角"（rad 或 deg），方向换算在内部完成：
//   关节角 = dir × 电机角；下发时同样乘 dir 还原到电机坐标。
// ============================================================================
#pragma once
#include <Arduino.h>
#include "dm4310_protocol.h"
#include "dm4310_twai.h"

namespace dm4310 {

static const float RAD2DEG = 57.29577951f;
static const float DEG2RAD = 0.0174532925f;

class Joint {
public:
  Joint(uint8_t can_id, uint8_t master_id, int8_t dir,
        const Range& range = range_dm4310())
    : can_id_(can_id), master_id_(master_id), dir_(dir), range_(range) {}

  uint8_t masterId() const { return master_id_; }
  const Range& range() const { return range_; }

  bool enable()    { uint8_t d[8]; pack_enable(d);    return bus_send_frame(can_id_, d); }
  bool disable()   { uint8_t d[8]; pack_disable(d);   return bus_send_frame(can_id_, d); }
  bool setZero()   { uint8_t d[8]; pack_set_zero(d);  return bus_send_frame(can_id_, d); }
  bool clearError(){ uint8_t d[8]; pack_clear_err(d); return bus_send_frame(can_id_, d); }

  void command(float joint_p_rad, float joint_v_rad_s, float kp, float kd,
               float tau_ff_nm = 0.0f) {
    uint8_t d[8];
    pack_mit(range_, dir_ * joint_p_rad, dir_ * joint_v_rad_s,
             kp, kd, dir_ * tau_ff_nm, d);
    bus_send_frame(can_id_, d);
  }

  void handleFeedback(const Feedback& fb, uint32_t now_ms) {
    online_ = true;
    last_ms_ = now_ms;
    err_ = fb.err;
    pos_rad_ = dir_ * fb.p;
    vel_rads_ = dir_ * fb.v;
    tau_nm_ = dir_ * fb.t;
  }

  bool   online()  const { return online_; }
  uint8_t err()    const { return err_; }
  float  posRad()  const { return pos_rad_; }
  float  posDeg()  const { return pos_rad_ * RAD2DEG; }
  float  velDegS() const { return vel_rads_ * RAD2DEG; }
  float  tauNm()   const { return tau_nm_; }
  uint32_t lastMs() const { return last_ms_; }

private:
  uint8_t can_id_;
  uint8_t master_id_;
  int8_t  dir_;
  Range   range_;
  bool     online_  = false;
  uint8_t  err_     = 0;
  float    pos_rad_ = 0.0f;
  float    vel_rads_ = 0.0f;
  float    tau_nm_  = 0.0f;
  uint32_t last_ms_ = 0;
};

// 收干总线上所有反馈帧并按 MASTER_ID 分发（非阻塞，主循环每周期调用一次）
inline void pump(Joint** joints, size_t count, uint32_t now_ms) {
  twai_message_t msg;
  while (bus_receive(msg, 0)) {
    if (msg.extd || msg.rtr || msg.data_length_code != 8) continue;
    for (size_t i = 0; i < count; ++i) {
      if (joints[i]->masterId() == msg.identifier) {
        Feedback fb;
        unpack_feedback(joints[i]->range(), msg.data, fb);
        joints[i]->handleFeedback(fb, now_ms);
        break;
      }
    }
  }
}

} // namespace dm4310