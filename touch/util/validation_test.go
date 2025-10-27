package util

import (
	"regexp"
	"testing"
)

func TestRegexPattern(t *testing.T) {
	pattern := `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`
	_, err := regexp.Compile(pattern)
	if err != nil {
		t.Errorf("Regex pattern compilation failed: %v", err)
	} else {
		t.Log("Regex pattern is valid")
	}
}

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		config   *PasswordConfig
		wantErr  bool
		errMsg   string
	}{
		// Valid password tests
		{
			name:     "valid password with default config",
			password: "Test123!@#",
			config:   nil, // Should use default config
			wantErr:  false,
		},
		{
			name:     "valid password with custom config",
			password: "MyPass123!",
			config: &PasswordConfig{
				Pattern:   `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`,
				MinLength: 8,
				MaxLength: 20,
			},
			wantErr: false,
		},
		{
			name:     "minimum length valid password",
			password: "Test123!",
			config:   nil,
			wantErr:  false,
		},
		{
			name:     "maximum length valid password",
			password: "Test123!@#$%^&*()_+",
			config:   nil,
			wantErr:  false,
		},

		// Empty password test
		{
			name:     "empty password",
			password: "",
			config:   nil,
			wantErr:  true,
			errMsg:   "password cannot be empty",
		},

		// Length validation tests
		{
			name:     "password too short",
			password: "Test1!",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is too short",
		},
		{
			name:     "password too long",
			password: "Test123!@#$%^&*()_+=-",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is too long",
		},

		// Pattern validation tests
		{
			name:     "password without numbers",
			password: "TestPassword!",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing numbers",
		},
		{
			name:     "password without letters",
			password: "12345678!",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing English letters",
		},
		{
			name:     "password without symbols",
			password: "Test123456",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing symbols",
		},
		{
			name:     "password with only lowercase letters",
			password: "test123!",
			config:   nil,
			wantErr:  false, // Should be valid as pattern allows lowercase
		},
		{
			name:     "password with only uppercase letters",
			password: "TEST123!",
			config:   nil,
			wantErr:  false, // Should be valid as pattern allows uppercase
		},

		// Multiple missing requirements tests
		{
			name:     "password missing numbers and symbols",
			password: "TestPassword",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing numbers and symbols",
		},
		{
			name:     "password missing letters and symbols",
			password: "12345678",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing English letters and symbols",
		},
		{
			name:     "password missing letters and numbers",
			password: "!@#$%^&*",
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing numbers and English letters",
		},
		{
			name:     "password missing numbers and symbols",
			password: "--------", // Only contains dashes (symbols), missing numbers and letters
			config:   nil,
			wantErr:  true,
			errMsg:   "password is missing numbers and English letters",
		},

		// Invalid regex pattern test
		{
			name:     "invalid regex pattern",
			password: "Test123!",
			config: &PasswordConfig{
				Pattern:   "[invalid regex(", // Invalid regex
				MinLength: 8,
				MaxLength: 20,
			},
			wantErr: true,
			errMsg:  "invalid password pattern configuration",
		},

		// Custom length constraints
		{
			name:     "custom min length constraint",
			password: "Test1!",
			config: &PasswordConfig{
				Pattern:   `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{6,20}$`,
				MinLength: 10, // Stricter than pattern
				MaxLength: 20,
			},
			wantErr: true,
			errMsg:  "password is too short",
		},
		{
			name:     "custom max length constraint",
			password: "Test123!@#$%^",
			config: &PasswordConfig{
				Pattern:   `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`,
				MinLength: 8,
				MaxLength: 10, // Stricter than pattern
			},
			wantErr: true,
			errMsg:  "password is too long",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.password, tt.config)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ValidatePassword() expected error but got none")
					return
				}
				if tt.errMsg != "" && err.Error() != tt.errMsg {
					t.Errorf("ValidatePassword() error = %v, want %v", err.Error(), tt.errMsg)
				}
			} else {
				if err != nil {
					t.Errorf("ValidatePassword() unexpected error = %v", err)
				}
			}
		})
	}
}

func TestValidateName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantErr  bool
		errMsg   string
		wantBase64 string
	}{
		{
			name:       "valid name",
			input:      "JohnDoe",
			wantErr:    false,
			wantBase64: "Sm9obkRvZQ==",
		},
		{
			name:    "empty name",
			input:   "",
			wantErr: true,
			errMsg:  "name cannot be empty",
		},
		{
			name:    "name too short",
			input:   "John",
			wantErr: true,
			errMsg:  "name must be at least 5 characters long",
		},
		{
			name:    "name too long",
			input:   "ThisNameIsTooLongForValidation",
			wantErr: true,
			errMsg:  "name must be no more than 20 characters long",
		},
		{
			name:       "minimum length name",
			input:      "Alice",
			wantErr:    false,
			wantBase64: "QWxpY2U=",
		},
		{
			name:       "maximum length name",
			input:      "MaximumLengthNameOk",
			wantErr:    false,
			wantBase64: "TWF4aW11bUxlbmd0aE5hbWVPaw==",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ValidateName(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ValidateName() expected error but got none")
					return
				}
				if tt.errMsg != "" && err.Error() != tt.errMsg {
					t.Errorf("ValidateName() error = %v, want %v", err.Error(), tt.errMsg)
				}
			} else {
				if err != nil {
					t.Errorf("ValidateName() unexpected error = %v", err)
					return
				}
				if result != tt.wantBase64 {
					t.Errorf("ValidateName() result = %v, want %v", result, tt.wantBase64)
				}
			}
		})
	}
}

func TestDecodeName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantErr  bool
		errMsg   string
		wantName string
	}{
		{
			name:     "valid base64 name",
			input:    "Sm9obkRvZQ==",
			wantErr:  false,
			wantName: "JohnDoe",
		},
		{
			name:    "empty encoded name",
			input:   "",
			wantErr: true,
			errMsg:  "encoded name cannot be empty",
		},
		{
			name:    "invalid base64",
			input:   "InvalidBase64!",
			wantErr: true,
			errMsg:  "invalid base64 encoded name",
		},
		{
			name:     "valid base64 with padding",
			input:    "QWxpY2U=",
			wantErr:  false,
			wantName: "Alice",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := DecodeName(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("DecodeName() expected error but got none")
					return
				}
				if tt.errMsg != "" && err.Error() != tt.errMsg {
					t.Errorf("DecodeName() error = %v, want %v", err.Error(), tt.errMsg)
				}
			} else {
				if err != nil {
					t.Errorf("DecodeName() unexpected error = %v", err)
					return
				}
				if result != tt.wantName {
					t.Errorf("DecodeName() result = %v, want %v", result, tt.wantName)
				}
			}
		})
	}
}

func TestValidateEmail(t *testing.T) {
	tests := []struct {
		name    string
		email   string
		wantErr bool
		errMsg  string
	}{
		{
			name:    "valid email",
			email:   "test@example.com",
			wantErr: false,
		},
		{
			name:    "valid email with subdomain",
			email:   "user@mail.example.com",
			wantErr: false,
		},
		{
			name:    "valid email with numbers",
			email:   "user123@example123.com",
			wantErr: false,
		},
		{
			name:    "empty email",
			email:   "",
			wantErr: true,
			errMsg:  "email cannot be empty",
		},
		{
			name:    "invalid email format - no @",
			email:   "testexample.com",
			wantErr: true,
			errMsg:  "invalid email format",
		},
		{
			name:    "invalid email format - no domain",
			email:   "test@",
			wantErr: true,
			errMsg:  "invalid email format",
		},
		{
			name:    "invalid email format - no username",
			email:   "@example.com",
			wantErr: true,
			errMsg:  "invalid email format",
		},
		{
			name:    "invalid email format - multiple @",
			email:   "test@@example.com",
			wantErr: true,
			errMsg:  "invalid email format",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateEmail(tt.email)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ValidateEmail() expected error but got none")
					return
				}
				if tt.errMsg != "" && err.Error() != tt.errMsg {
					t.Errorf("ValidateEmail() error = %v, want %v", err.Error(), tt.errMsg)
				}
			} else {
				if err != nil {
					t.Errorf("ValidateEmail() unexpected error = %v", err)
				}
			}
		})
	}
}