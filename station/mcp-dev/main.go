package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/handler"
	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/service"
	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/storage"
)

func main() {
	// Initialize storage
	storage, err := storage.NewSQLiteStorage("mcp-dev.db")
	if err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}
	defer storage.Close()

	// Get GORM DB instance from storage
	db := storage.GetDB()

	// Initialize services
	ctxService := service.NewContextService(db)
	templateService := service.NewTemplateService(db)
	ruleService := service.NewRuleService(db)
	mcpService := service.NewMCPService(ctxService, templateService, ruleService)

	// Initialize handler
	h := handler.NewMCPHandler(mcpService)

	// Create Hertz server
	hertz := server.Default(server.WithHostPorts(":18888")) // Using port 18888 to avoid conflicts

	// Register MCP routes (includes health endpoint)
	h.RegisterRoutes(hertz)

	// Start server in goroutine
	go func() {
		if err := hertz.Run(); err != nil {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	log.Println("MCP Development Server started on :18888")

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown
	ctx := context.Background()
	if err := hertz.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server stopped")
}
