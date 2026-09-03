// 主机端协议回归：验证 DM4310 打包/解包数学（不依赖任何硬件）
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "../firmware/dm4310_protocol.h"

using namespace dm4310;

static int failures = 0;

#define CHECK_NEAR(actual, expected, tol, label)                            \
  do {                                                                      \
    double a_ = (double)(actual), e_ = (double)(expected);                   \
    if (fabs(a_ - e_) > (tol)) {                                            \
      printf("FAIL %s: actual=%.6f expected=%.6f tol=%g\n",                 \
             (label), a_, e_, (double)(tol));                                \
      ++failures;                                                            \
    }                                                                        \
  } while (0)

static void test_float_uint_roundtrip() {
  const Range rg = range_dm4310();
  const float ps[] = { -12.5f, -3.7f, 0.0f, 2.9f, 12.5f };
  for (size_t i = 0; i < sizeof(ps) / sizeof(ps[0]); ++i) {
    float back = uint_to_float(float_to_uint(ps[i], -rg.p_max, rg.p_max, 16),
                               -rg.p_max, rg.p_max, 16);
    CHECK_NEAR(back, ps[i], 25.0f / 65535.0f + 1e-6f, "p roundtrip");
  }
  const float vs[] = { -30.0f, -7.5f, 0.0f, 15.0f, 30.0f };
  for (size_t i = 0; i < sizeof(vs) / sizeof(vs[0]); ++i) {
    float back = uint_to_float((uint16_t)float_to_uint(vs[i], -rg.v_max, rg.v_max, 12),
                               -rg.v_max, rg.v_max, 12);
    CHECK_NEAR(back, vs[i], 60.0f / 4095.0f + 1e-6f, "v roundtrip(12bit)");
  }
}

static void test_float_uint_clamp() {
  CHECK_NEAR(uint_to_float(float_to_uint(99.0f, -12.5f, 12.5f, 16), -12.5f, 12.5f, 16), 12.5f, 1e-4f, "clamp hi");
  CHECK_NEAR(uint_to_float(float_to_uint(-99.0f, -12.5f, 12.5f, 16), -12.5f, 12.5f, 16), -12.5f, 1e-4f, "clamp lo");
  if (float_to_uint(-99.0f, -12.5f, 12.5f, 16) != 0) { printf("FAIL clamp raw lo\n"); ++failures; }
  if (float_to_uint(99.0f, -12.5f, 12.5f, 16) != 65535) { printf("FAIL clamp raw hi\n"); ++failures; }
}

static void test_pack_mit_zero_command() {
  const Range rg = range_dm4310();
  uint8_t d[8];
  pack_mit(rg, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, d);
  // 全零指令的期望字节: p中码=32767 v中码=2047 kp=0 kd=0 t中码=2047
  const uint8_t expect[8] = { 0x7F, 0xFF, 0x7F, 0xF0, 0x00, 0x00, 0x07, 0xFF };
  for (int i = 0; i < 8; ++i) {
    if (d[i] != expect[i]) {
      printf("FAIL pack zero byte%d: got=0x%02X want=0x%02X\n", i, d[i], expect[i]);
      ++failures;
    }
  }
}

static void test_pack_mit_known_values() {
  const Range rg = range_dm4310();
  uint8_t d[8];
  pack_mit(rg, 3.0f, 0.0f, 20.0f, 1.0f, 0.0f, d);
  uint16_t pi = ((uint16_t)d[0] << 8) | d[1];
  uint16_t vi = (uint16_t)((d[2] << 4) | (d[3] >> 4));
  uint16_t kpi = (uint16_t)(((d[3] & 0xF) << 8) | d[4]);
  uint16_t kdi = (uint16_t)((d[5] << 4) | (d[6] >> 4));
  CHECK_NEAR(uint_to_float(pi, -rg.p_max, rg.p_max, 16), 3.0f, 0.001f, "pack p");
  CHECK_NEAR(uint_to_float(vi, -rg.v_max, rg.v_max, 12), 0.0f, 0.03f, "pack v");
  CHECK_NEAR(uint_to_float(kpi, 0, rg.kp_max, 12), 20.0f, 0.25f, "pack kp");
  CHECK_NEAR(uint_to_float(kdi, 0, rg.kd_max, 12), 1.0f, 0.05f, "pack kd");
}

static void test_unpack_feedback_synthetic() {
  const Range rg = range_dm4310();
  uint8_t f[8];
  f[0] = 0x23; f[1] = 0x01;
  uint16_t pi = float_to_uint(3.0f, -rg.p_max, rg.p_max, 16);
  uint16_t vi = float_to_uint(-5.0f, -rg.v_max, rg.v_max, 16);
  uint16_t ti = float_to_uint(2.0f, -rg.t_max, rg.t_max, 16);
  f[2] = (uint8_t)(pi >> 8);  f[3] = (uint8_t)(pi & 0xFF);
  f[4] = (uint8_t)(vi >> 8);  f[5] = (uint8_t)(vi & 0xFF);
  f[6] = (uint8_t)(ti >> 8);  f[7] = (uint8_t)(ti & 0xFF);

  Feedback fb;
  unpack_feedback(rg, f, fb);
  if (fb.id != 0x123) { printf("FAIL fb id: got=0x%X\n", fb.id); ++failures; }
  if (fb.err != 0) { printf("FAIL fb err: got=0x%X\n", fb.err); ++failures; }
  CHECK_NEAR(fb.p, 3.0f, 0.001f, "fb p");
  CHECK_NEAR(fb.v, -5.0f, 0.002f, "fb v");
  CHECK_NEAR(fb.t, 2.0f, 0.001f, "fb t");

  f[0] = 0x21; f[1] = 0xD1;
  unpack_feedback(rg, f, fb);
  if (fb.id != 0x121) { printf("FAIL fb id2: got=0x%X\n", fb.id); ++failures; }
  if (fb.err != 0xD || strcmp(error_name(fb.err), "LOST_FRAME") != 0) {
    printf("FAIL fb err2: got=0x%X %s\n", fb.err, error_name(fb.err));
    ++failures;
  }
}

static void test_special_frames() {
  uint8_t d[8];
  pack_enable(d);
  for (int i = 0; i < 7; ++i)
    if (d[i] != 0xFF) { printf("FAIL enable prefix byte%d\n", i); ++failures; }
  if (d[7] != 0xFC) { printf("FAIL enable tail\n"); ++failures; }
  pack_disable(d);  if (d[7] != 0xFD) { printf("FAIL disable\n"); ++failures; }
  pack_set_zero(d); if (d[7] != 0xFE) { printf("FAIL setzero\n"); ++failures; }
  pack_clear_err(d);if (d[7] != 0xFB) { printf("FAIL clearerr\n"); ++failures; }
}

int main() {
  test_float_uint_roundtrip();
  test_float_uint_clamp();
  test_pack_mit_zero_command();
  test_pack_mit_known_values();
  test_unpack_feedback_synthetic();
  test_special_frames();
  if (failures == 0) {
    printf("dm4310 protocol: ALL PASS\n");
    return 0;
  }
  printf("dm4310 protocol: %d FAILURES\n", failures);
  return 1;
}