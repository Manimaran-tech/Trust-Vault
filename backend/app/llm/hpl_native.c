#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <string.h>
#include <ctype.h>
#include <stdlib.h>
#include <math.h>

// Helper to check if string contains substring (case-insensitive)
static int str_contains_ic(const char *haystack, const char *needle) {
    if (!haystack || !needle) return 0;
    
    size_t needle_len = strlen(needle);
    if (needle_len == 0) return 1;
    
    const char *h = haystack;
    while (*h) {
        if (tolower((unsigned char)*h) == tolower((unsigned char)*needle)) {
            const char *h_sub = h;
            const char *n_sub = needle;
            while (*h_sub && *n_sub && tolower((unsigned char)*h_sub) == tolower((unsigned char)*n_sub)) {
                h_sub++;
                n_sub++;
            }
            if (!*n_sub) return 1;
        }
        h++;
    }
    return 0;
}

static PyObject* check_factual_consistency(PyObject *self, PyObject *args) {
    const char *reasoning;
    double tx_amount;
    const char *merchant_country;

    // Parse arguments: (string, double, string)
    if (!PyArg_ParseTuple(args, "sds", &reasoning, &tx_amount, &merchant_country)) {
        return NULL;
    }

    PyObject *errors_list = PyList_New(0);
    if (!errors_list) return NULL;

    // 1. Categorical Checks (Fast String Scan)
    const char* high_risk[] = {"north korea", "iran", "syria", "cuba", "crimea", "russia", "venezuela", "myanmar", "belarus"};
    int num_high_risk = 9;
    
    char *merchant_country_lower = strdup(merchant_country);
    for (int i = 0; merchant_country_lower[i]; i++) {
        merchant_country_lower[i] = tolower((unsigned char)merchant_country_lower[i]);
    }

    for (int i = 0; i < num_high_risk; i++) {
        if (str_contains_ic(reasoning, high_risk[i])) {
            if (!str_contains_ic(merchant_country_lower, high_risk[i])) {
                char error_msg[256];
                snprintf(error_msg, sizeof(error_msg), "Hallucinated high-risk entity: '%s'.", high_risk[i]);
                PyObject *py_str = PyUnicode_FromString(error_msg);
                PyList_Append(errors_list, py_str);
                Py_DECREF(py_str);
            }
        }
    }
    free(merchant_country_lower);

    // 2. Numerical Checks
    // Basic scan for digits following '$' or standalone numbers
    const char *p = reasoning;
    int numerical_error_found = 0;

    while (*p && !numerical_error_found) {
        if (*p == '$' || isdigit((unsigned char)*p)) {
            if (*p == '$') p++;
            
            if (isdigit((unsigned char)*p)) {
                // Extract number
                char num_buf[64];
                int buf_idx = 0;
                while (*p && (isdigit((unsigned char)*p) || *p == '.' || *p == ',')) {
                    if (*p != ',') {
                        if (buf_idx < 63) {
                            num_buf[buf_idx++] = *p;
                        }
                    }
                    p++;
                }
                num_buf[buf_idx] = '\0';

                // Convert to double
                char *endptr;
                double val = strtod(num_buf, &endptr);
                
                if (endptr != num_buf) { // Valid parse
                    // Ignore specific thresholds
                    int is_threshold = 0;
                    double thresholds[] = {5000, 10000, 15000, 25000, 50000, 75000, 150000, 200000, 500000};
                    for (int i=0; i<9; i++) {
                        if (fabs(val - thresholds[i]) < 0.1) {
                            is_threshold = 1;
                            break;
                        }
                    }

                    if (!is_threshold && val >= 1000.0) {
                        if (fabs(val - tx_amount) > 1.0) {
                            char error_msg[256];
                            snprintf(error_msg, sizeof(error_msg), "Hallucinated numerical value: %.2f. Actual transaction amount is %.2f.", val, tx_amount);
                            PyObject *py_str = PyUnicode_FromString(error_msg);
                            PyList_Append(errors_list, py_str);
                            Py_DECREF(py_str);
                            numerical_error_found = 1; // Limit to 1 error
                        }
                    }
                }
            }
        } else {
            p++;
        }
    }

    return errors_list;
}

// Method definition
static PyMethodDef HPLMethods[] = {
    {"check_factual_consistency", check_factual_consistency, METH_VARARGS, "Cross-reference LLM output with ground-truth transaction data natively."},
    {NULL, NULL, 0, NULL}
};

// Module definition
static struct PyModuleDef hplmodule = {
    PyModuleDef_HEAD_INIT,
    "hpl_native",
    "True Native C Extension for Hallucination Prevention Layer",
    -1,
    HPLMethods
};

PyMODINIT_FUNC PyInit_hpl_native(void) {
    return PyModule_Create(&hplmodule);
}
