#!/usr/bin/env bash
# Shared test helpers for setup script tests.

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0
CURRENT_SUITE=""

suite() {
  CURRENT_SUITE="$1"
  printf "\n=== %s ===\n" "$CURRENT_SUITE"
}

assert_eq() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$expected" = "$actual" ]; then
    printf "  PASS: %s\n" "$description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: %s\n    expected: %s\n    actual:   %s\n" "$description" "$expected" "$actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_contains() {
  local description="$1"
  local haystack="$2"
  local needle="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if echo "$haystack" | grep -qF -- "$needle"; then
    printf "  PASS: %s\n" "$description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: %s\n    expected to contain: %s\n    actual: %s\n" "$description" "$needle" "$haystack"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_not_contains() {
  local description="$1"
  local haystack="$2"
  local needle="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if ! echo "$haystack" | grep -qF -- "$needle"; then
    printf "  PASS: %s\n" "$description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: %s\n    expected NOT to contain: %s\n" "$description" "$needle"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_file_exists() {
  local description="$1"
  local filepath="$2"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ -f "$filepath" ]; then
    printf "  PASS: %s\n" "$description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: %s\n    file not found: %s\n" "$description" "$filepath"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_dir_exists() {
  local description="$1"
  local dirpath="$2"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ -d "$dirpath" ]; then
    printf "  PASS: %s\n" "$description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: %s\n    directory not found: %s\n" "$description" "$dirpath"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_exit_code() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  assert_eq "$description (exit code)" "$expected" "$actual"
}

report() {
  printf "\n--- Results ---\n"
  printf "Total: %d  Passed: %d  Failed: %d\n" "$TESTS_TOTAL" "$TESTS_PASSED" "$TESTS_FAILED"
  if [ "$TESTS_FAILED" -gt 0 ]; then
    return 1
  fi
  return 0
}
